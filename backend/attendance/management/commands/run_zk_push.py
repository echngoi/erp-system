"""
ZK Push Binary TCP Server — Django Management Command
=====================================================

Runs an asyncio TCP server on port 7005 to receive ZK Push binary
protocol data from Ronald Jack AI06F attendance machines (ADMS mode).

Usage:
    python manage.py run_zk_push [--port 7005] [--host 0.0.0.0]

The server:
  1. Accepts TCP connections from attendance machines
  2. Parses ZK binary protocol packets (magic: 0xA5 0x5A)
  3. Sends appropriate ACK responses
  4. Saves attendance records to Django database
  5. Pushes real-time notifications via WebSocket (channels)
"""
import asyncio
import logging
import signal
import struct
import time
from datetime import datetime

from django.core.management.base import BaseCommand
from django.utils import timezone

from attendance.zk_push_protocol import (
    MAGIC, HEADER_SIZE, CMD_NAMES,
    CMD_REGISTER, CMD_HEARTBEAT,
    CMD_PUSH_ATTLOG, CMD_PUSH_USERINFO, CMD_PUSH_OPERLOG,
    CMD_REGISTER_ACK, CMD_HEARTBEAT_ACK,
    CMD_PUSH_ATTLOG_ACK, CMD_PUSH_USERINFO_ACK, CMD_PUSH_OPERLOG_ACK,
    parse_packet, find_packets,
    build_register_ack, build_heartbeat_ack, build_data_ack, build_response,
    parse_attlog_payload, parse_attlog_text_in_binary,
    _compute_checksum, _apply_checksum,
)

logger = logging.getLogger('attendance.zk_push')

# Timeout: close connection if no data for this many seconds
CLIENT_TIMEOUT = 300  # 5 minutes

# ── Rate limiter for rapid-reconnect protection ───────────────────────────────
# From Mita Pro capture: Connection #1 (probe) ALWAYS closes after ACK.
# Connection #2 (3.5 sec later) stays connected. On WAN, device rapid-reconnects
# every 30ms and gets stuck in probe mode forever. Fix: don't ACK rapid
# reconnects, forcing device to slow down. Once gap > 2s, ACK normally.
_device_last_ack_time = {}    # IP → timestamp of last ACK sent
_device_rapid_count = {}      # IP → count of suppressed rapid reconnects

RAPID_RECONNECT_THRESHOLD = 2.0  # seconds — below this = rapid reconnect


class ZKPushClientHandler:
    """Handles a single TCP connection from an attendance machine."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer
        self.addr = writer.get_extra_info('peername')
        self.serial_number = 'unknown'
        self.registered = False
        self.server_seq = 0
        self._buffer = b''

    async def handle(self):
        """Main connection handler loop."""
        ip = self.addr[0] if self.addr else 'unknown'
        logger.warning(f"[ZK-TCP] New connection from {ip}")

        try:
            while True:
                try:
                    data = await asyncio.wait_for(
                        self.reader.read(4096),
                        timeout=CLIENT_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    logger.info(f"[ZK-TCP] Timeout from {ip} (SN={self.serial_number})")
                    break

                if not data:
                    logger.info(f"[ZK-TCP] Connection closed by {ip} (SN={self.serial_number})")
                    break

                self._buffer += data
                await self._process_buffer()

        except ConnectionResetError:
            logger.warning(f"[ZK-TCP] Connection reset by {ip} (SN={self.serial_number})")
        except Exception as e:
            logger.error(f"[ZK-TCP] Error handling {ip} (SN={self.serial_number}): {e}",
                         exc_info=True)
        finally:
            try:
                self.writer.close()
                await self.writer.wait_closed()
            except Exception:
                pass
            logger.warning(f"[ZK-TCP] Disconnected: {ip} (SN={self.serial_number})")

    async def _process_buffer(self):
        """Process all complete packets in the buffer."""
        while len(self._buffer) >= 4:
            # Find magic header
            magic_pos = self._buffer.find(MAGIC)
            if magic_pos == -1:
                # No magic found, discard buffer but log it
                if self._buffer:
                    logger.warning(f"[ZK-TCP] No magic in buffer from "
                                   f"SN={self.serial_number}, discarding "
                                   f"{len(self._buffer)} bytes: "
                                   f"{self._buffer[:64].hex()}")
                self._buffer = b''
                return

            # Discard bytes before magic
            if magic_pos > 0:
                logger.debug(f"[ZK-TCP] Skipping {magic_pos} bytes before magic")
                self._buffer = self._buffer[magic_pos:]

            # Need at least header to parse
            if len(self._buffer) < HEADER_SIZE:
                return  # Wait for more data

            # Try to find the next packet to determine this packet's length
            next_magic = self._buffer.find(MAGIC, 2)
            if next_magic == -1:
                # Only one packet (or incomplete second), use entire buffer
                # But wait for more data if we recently received
                packet_data = self._buffer
                self._buffer = b''
            else:
                packet_data = self._buffer[:next_magic]
                self._buffer = self._buffer[next_magic:]

            packet = parse_packet(packet_data)
            if packet:
                await self._handle_packet(packet)
            else:
                logger.warning(f"[ZK-TCP] Failed to parse packet: "
                               f"{packet_data[:64].hex()}")

    async def _handle_packet(self, packet):
        """Dispatch packet to appropriate handler based on command."""
        ip = self.addr[0] if self.addr else 'unknown'

        logger.info(f"[ZK-TCP] Packet from {ip}: cmd={packet.cmd_name} "
                     f"seq={packet.send_seq} SN={packet.serial_number} "
                     f"payload={len(packet.payload)}B")

        if packet.serial_number and packet.serial_number != 'unknown':
            self.serial_number = packet.serial_number

        # Log full hex dump for unknown/new command types
        if packet.command not in CMD_NAMES:
            logger.warning(f"[ZK-TCP] Unknown command packet: {packet.hex_dump(128)}")

        # Dispatch by command
        if packet.command == CMD_REGISTER:
            await self._handle_register(packet)
        elif packet.command == CMD_HEARTBEAT:
            await self._handle_heartbeat(packet)
        elif packet.command == CMD_PUSH_ATTLOG:
            await self._handle_attlog(packet)
        elif packet.command == CMD_PUSH_USERINFO:
            await self._handle_userinfo(packet)
        elif packet.command == CMD_PUSH_OPERLOG:
            await self._handle_operlog(packet)
        else:
            # Unknown command — try multiple response strategies
            await self._handle_unknown(packet)

    async def _handle_register(self, packet):
        """Handle REGISTER — send 16-byte reversed-magic ACK.

        Protocol reverse-engineered from Mita Pro 2024 ADMS capture:
        - First REGISTER on a connection: ACK with byte[4] = seq+1
        - Subsequent REGISTERs (heartbeat): ACK with byte[4] = echo seq
        - Rate limiting only applies to FIRST REGISTER of NEW connections
        - Device needs 2-4 probe/settle cycles before staying connected on WAN
        """
        ip = self.addr[0] if self.addr else 'unknown'
        now = time.time()
        raw = packet.raw

        # ── CASE 1: Already registered on THIS connection (heartbeat) ─────
        # Always ACK immediately — never rate-limit heartbeat REGISTERs!
        # From Mita Pro capture: heartbeat ACKs use echo seq (not seq+1)
        if self.registered:
            _device_last_ack_time[ip] = now

            # Decode session and flags for event detection
            session_val = struct.unpack_from('<I', raw, 8)[0]  # uint32 LE
            byte12 = raw[12]
            byte13 = raw[13]

            # ── PUNCH EVENT: session != 0 means attendance event ──────────
            # From proxy capture: Mita Pro session=0x1e when punch, VPS session=0x78
            # session value = user_id who just punched (uint32 LE)
            if session_val != 0:
                logger.warning(f"[ZK-TCP] ★★ PUNCH EVENT from SN={packet.serial_number} "
                               f"session=0x{session_val:X} ({session_val}) "
                               f"byte12={byte12} byte13={byte13} "
                               f"raw={raw.hex()}")
                # Save attendance record!
                await self._handle_punch_event(packet.serial_number, session_val)

            # ── DATA READY: byte12=0x01 means device has pending data ─────
            elif byte12 == 0x01:
                logger.warning(f"[ZK-TCP] 📦 Data-ready signal from SN={packet.serial_number} "
                               f"seq={packet.send_seq} byte12={byte12} byte13={byte13}")
            else:
                logger.info(f"[ZK-TCP] 💓 Heartbeat REGISTER from SN={packet.serial_number} "
                            f"seq={packet.send_seq} — sending echo ACK")

            # Update device contact (write shared file every ~30s, not every 3s)
            if not hasattr(self, '_last_contact_write') or (now - self._last_contact_write) > 30:
                self._last_contact_write = now
                await self._record_device_contact()

            ack = bytearray(16)
            ack[0:2] = b'\x5a\xa5'
            ack[2:4] = raw[2:4]
            ack[4] = raw[4]                   # ECHO seq (not +1) for heartbeat
            ack[5] = raw[5]
            ack[6:8] = raw[6:8]
            ack[8:12] = raw[8:12]
            ack[12] = 0x32
            ack[13] = 0x01
            ack[14] = sum(ack[0:14]) & 0xFF
            ack[15] = raw[15]

            await self._send(bytes(ack))
            return

        # ── CASE 2: First REGISTER on new connection — rate limit ─────────
        last_ack = _device_last_ack_time.get(ip, 0)
        gap = now - last_ack

        if gap < RAPID_RECONNECT_THRESHOLD:
            count = _device_rapid_count.get(ip, 0) + 1
            _device_rapid_count[ip] = count
            if count == 1 or count % 100 == 0:
                logger.warning(f"[ZK-TCP] ⚡ Rapid reconnect #{count} from "
                               f"SN={packet.serial_number} (gap={gap:.3f}s) "
                               f"— suppressing ACK, waiting for device to settle")
            return  # Don't send ACK — device will timeout and slow down

        # Gap is sufficient — send ACK (first REGISTER with seq+1)
        rapid_count = _device_rapid_count.get(ip, 0)
        if rapid_count > 0:
            logger.warning(f"[ZK-TCP] ✓ Device {packet.serial_number} settled down "
                           f"after {rapid_count} rapid reconnects (gap={gap:.1f}s)")
            _device_rapid_count[ip] = 0

        _device_last_ack_time[ip] = now

        logger.warning(f"[ZK-TCP] ★ Registration from SN={packet.serial_number} "
                       f"seq={packet.send_seq} recv_seq={packet.recv_seq} "
                       f"proto_ver={packet.proto_ver}")
        logger.info(f"[ZK-TCP] REGISTER raw ({len(packet.raw)}B): {packet.raw.hex()}")

        self.registered = True
        self.serial_number = packet.serial_number
        await self._record_device_contact()

        # Build 16-byte ACK — first REGISTER uses seq+1 (verified from Mita Pro)
        ack = bytearray(16)
        ack[0:2] = b'\x5a\xa5'           # Reversed magic (server→device)
        ack[2:4] = raw[2:4]              # Echo command (01 00 = REGISTER)
        ack[4] = (raw[4] + 1) & 0xFF     # seq+1 for FIRST register on connection
        ack[5] = raw[5]                   # Echo client's recv_seq byte
        ack[6:8] = raw[6:8]              # Echo proto_ver ("b1")
        ack[8:12] = raw[8:12]            # Echo session/comm-key bytes from client
        ack[12] = 0x32                    # ACK status code
        ack[13] = 0x01                    # Fixed
        ack[14] = sum(ack[0:14]) & 0xFF   # Checksum = sum(bytes[0..13]) % 256
        ack[15] = raw[15]                 # Echo footer/version byte from client (02 or 03)

        ack_bytes = bytes(ack)
        logger.info(f"[ZK-TCP] Sending REGISTER ACK (16B): {ack_bytes.hex()}")
        await self._send(ack_bytes)

    async def _handle_punch_event(self, serial_number, session_val):
        """Handle attendance punch event embedded in heartbeat REGISTER.

        The device signals a new punch via session bytes != 0 in a heartbeat
        REGISTER packet. session_val = user_id on the device (uint32 LE).

        Verified from captures:
        - Mita Pro proxy: session=0x1e (30) when user punched
        - VPS logs: session=0x78 (120) when user punched
        """
        from attendance.zk_push_protocol import AttendanceRecord

        ts = datetime.now()
        user_id = str(session_val)

        logger.warning(f"[ZK-TCP] ★ Saving punch: user_id={user_id} "
                       f"time={ts.strftime('%Y-%m-%d %H:%M:%S')} "
                       f"SN={serial_number}")

        record = AttendanceRecord(
            user_id=user_id,
            timestamp=ts,
            status=0,      # Check-in by default
            punch=0,
        )

        saved, new_records = await self._save_attendance_records([record])

        if new_records:
            await self._notify_websocket(new_records)
            logger.warning(f"[ZK-TCP] ✓ Punch saved and pushed to WebSocket! "
                           f"user={user_id} saved={saved}")
        else:
            logger.warning(f"[ZK-TCP] Punch record: user={user_id} "
                           f"saved={saved} (may be duplicate)")

    async def _handle_heartbeat(self, packet):
        """Handle keep-alive heartbeat."""
        logger.debug(f"[ZK-TCP] Heartbeat from SN={self.serial_number}")
        await self._record_device_contact()

        self.server_seq = (self.server_seq + 1) & 0xFF
        ack = build_heartbeat_ack(packet, self.server_seq)
        await self._send(ack)

    async def _handle_attlog(self, packet):
        """Handle attendance log data push."""
        logger.warning(f"[ZK-TCP] ★ ATTLOG from SN={self.serial_number} "
                       f"payload={len(packet.payload)}B")

        if packet.payload:
            logger.info(f"[ZK-TCP] ATTLOG payload hex: {packet.payload[:160].hex()}")

        records = []

        # Try binary format parsing
        if packet.payload:
            records = parse_attlog_payload(packet.payload, self.serial_number)

        # Fallback: try text-in-binary parsing
        if not records and packet.payload:
            records = parse_attlog_text_in_binary(packet.payload, self.serial_number)

        saved = 0
        new_records = []
        if records:
            saved, new_records = await self._save_attendance_records(records)

        # Send 16-byte ACK (same format as REGISTER ACK)
        ack = self._build_16byte_ack(packet.raw)
        logger.info(f"[ZK-TCP] Sending ATTLOG ACK (16B): {ack.hex()}")
        await self._send(ack)

        # Push to frontend via WebSocket
        if new_records:
            await self._notify_websocket(new_records)

        logger.warning(f"[ZK-TCP] ATTLOG: parsed={len(records)} saved={saved} "
                       f"new={len(new_records)}")

    async def _handle_userinfo(self, packet):
        """Handle user info data push."""
        logger.warning(f"[ZK-TCP] USERINFO from SN={self.serial_number} "
                       f"payload={len(packet.payload)}B")
        if packet.payload:
            logger.info(f"[ZK-TCP] USERINFO payload hex: {packet.payload[:160].hex()}")

        # Send 16-byte ACK
        ack = self._build_16byte_ack(packet.raw)
        await self._send(ack)

    async def _handle_operlog(self, packet):
        """Handle operation log push."""
        logger.info(f"[ZK-TCP] OPERLOG from SN={self.serial_number} "
                     f"payload={len(packet.payload)}B")

        ack = self._build_16byte_ack(packet.raw)
        await self._send(ack)

    async def _handle_unknown(self, packet):
        """Handle unknown command — send generic ACK."""
        logger.warning(f"[ZK-TCP] Unknown cmd=0x{packet.command:04X} from "
                       f"SN={self.serial_number}: {packet.hex_dump(128)}")

        # Try responding with command + 1 (common ACK pattern)
        ack_cmd = packet.command + 1
        self.server_seq = (self.server_seq + 1) & 0xFF
        ack = build_response(packet, ack_cmd, self.server_seq)
        await self._send(ack)

        # Also log payload for analysis
        if packet.has_payload:
            logger.warning(f"[ZK-TCP] Unknown cmd payload: {packet.payload[:200].hex()}")

            # Try parsing as attendance data (some firmware uses non-standard command IDs)
            records = parse_attlog_payload(packet.payload, self.serial_number)
            if not records:
                records = parse_attlog_text_in_binary(packet.payload, self.serial_number)
            if records:
                saved, new_records = await self._save_attendance_records(records)
                if new_records:
                    await self._notify_websocket(new_records)
                logger.warning(f"[ZK-TCP] Unknown cmd had parseable ATTLOG! "
                               f"saved={saved}")

    def _build_16byte_ack(self, raw: bytes) -> bytes:
        """Build standard 16-byte reversed-magic ACK for any packet.

        Same format as REGISTER ACK — verified from Mita Pro capture:
        5A A5 + echo cmd + echo seq + echo recv_seq + echo proto +
        echo session + 32 01 + checksum + echo footer
        """
        ack = bytearray(16)
        ack[0:2] = b'\x5a\xa5'
        ack[2:4] = raw[2:4]               # Echo command
        ack[4] = raw[4]                    # Echo seq
        ack[5] = raw[5]                    # Echo recv_seq
        ack[6:8] = raw[6:8]               # Echo proto_ver
        ack[8:12] = raw[8:12]             # Echo session
        ack[12] = 0x32                     # ACK status
        ack[13] = 0x01                     # Fixed
        ack[14] = sum(ack[0:14]) & 0xFF    # Checksum
        ack[15] = raw[15] if len(raw) > 15 else 0x02  # Echo footer
        return bytes(ack)

    async def _send(self, data: bytes):
        """Send data to the device."""
        try:
            self.writer.write(data)
            await self.writer.drain()
        except Exception as e:
            logger.error(f"[ZK-TCP] Send error to SN={self.serial_number}: {e}")

    async def _record_device_contact(self):
        """Record device contact in ADMS registry (thread-safe)."""
        try:
            sn = self.serial_number
            ip = self.addr[0] if self.addr else None
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _sync_record_contact, sn, ip)
        except Exception as e:
            logger.debug(f"[ZK-TCP] Record contact error: {e}")

    async def _save_attendance_records(self, records) -> tuple:
        """Save parsed attendance records to database."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, _sync_save_attendance, records, self.serial_number
        )

    async def _notify_websocket(self, new_records: list):
        """Push new records to frontend via WebSocket channel layer."""
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            channel_layer = get_channel_layer()
            if channel_layer:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(
                    None,
                    async_to_sync(channel_layer.group_send),
                    'attendance_live',
                    {
                        'type': 'attendance.push',
                        'data': {
                            'records': new_records,
                            'source': 'zk_push_tcp',
                        },
                    },
                )
        except Exception as e:
            logger.debug(f"[ZK-TCP] WebSocket notify error: {e}")


# ── Sync database operations (run in thread pool) ─────────────────────────────

def _sync_record_contact(sn, ip):
    """Record device contact (sync, for thread pool)."""
    from attendance.zk_service import adms_record_contact
    adms_record_contact(sn, ip=ip)


def _sync_save_attendance(records, sn):
    """Save attendance records to database (sync, for thread pool)."""
    from attendance.models import Employee, AttendanceLog, SyncLog
    from django.utils import timezone as tz

    saved = 0
    new_records = []

    for rec in records:
        try:
            ts = rec.timestamp
            if timezone.is_naive(ts):
                ts = timezone.make_aware(ts)

            employee = Employee.objects.filter(user_id=rec.user_id).first()
            _, created = AttendanceLog.objects.get_or_create(
                user_id=rec.user_id,
                timestamp=ts,
                defaults={
                    'employee': employee,
                    'status': rec.status,
                    'punch': rec.punch,
                }
            )
            if created:
                saved += 1
                new_records.append({
                    'user_id': rec.user_id,
                    'employee_name': employee.name if employee else rec.user_id,
                    'timestamp': tz.localtime(ts).strftime('%Y-%m-%d %H:%M:%S'),
                    'punch': rec.punch,
                })
                logger.info(f"[ZK-TCP] Saved: user={rec.user_id} "
                            f"ts={ts} punch={rec.punch}")
        except Exception as e:
            logger.warning(f"[ZK-TCP] Save error for user={rec.user_id}: {e}")

    if saved > 0:
        SyncLog.objects.create(
            status='success',
            records_synced=saved,
            finished_at=tz.now(),
        )

    return saved, new_records


# ── Server ─────────────────────────────────────────────────────────────────────

class ZKPushTCPServer:
    """asyncio TCP server for ZK Push binary protocol."""

    def __init__(self, host='0.0.0.0', port=7005):
        self.host = host
        self.port = port
        self.server = None
        self._clients = set()

    async def handle_client(self, reader, writer):
        handler = ZKPushClientHandler(reader, writer)
        self._clients.add(handler)
        try:
            await handler.handle()
        finally:
            self._clients.discard(handler)

    async def start(self):
        self.server = await asyncio.start_server(
            self.handle_client,
            self.host,
            self.port,
        )
        addrs = ', '.join(str(sock.getsockname()) for sock in self.server.sockets)
        logger.warning(f"[ZK-TCP] ★ Server listening on {addrs}")
        print(f"→ ZK Push TCP Server listening on {addrs}")

        async with self.server:
            await self.server.serve_forever()

    async def stop(self):
        if self.server:
            self.server.close()
            await self.server.wait_closed()
            logger.warning("[ZK-TCP] Server stopped")


# ── Django Management Command ──────────────────────────────────────────────────

class Command(BaseCommand):
    help = 'Run ZK Push Binary TCP Server for attendance machine communication'

    def add_arguments(self, parser):
        parser.add_argument('--host', default='0.0.0.0', help='Bind address (default: 0.0.0.0)')
        parser.add_argument('--port', type=int, default=7005, help='TCP port (default: 7005)')

    def handle(self, *args, **options):
        host = options['host']
        port = options['port']

        # Configure logging
        logging.basicConfig(
            level=logging.INFO,
            format='[%(asctime)s] %(levelname)s %(name)s: %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S',
        )

        self.stdout.write(self.style.SUCCESS(
            f'Starting ZK Push TCP Server on {host}:{port}...'
        ))

        server = ZKPushTCPServer(host=host, port=port)
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        # Handle shutdown signals
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, lambda: asyncio.ensure_future(server.stop()))
            except NotImplementedError:
                pass  # Windows doesn't support add_signal_handler

        try:
            loop.run_until_complete(server.start())
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING('\nShutting down...'))
            loop.run_until_complete(server.stop())
        finally:
            loop.close()
