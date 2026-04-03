"""
ZK Push Binary TCP Server — Django Management Command
=====================================================

Runs an asyncio TCP server on port 5005 to receive ZK Push binary
protocol data from Ronald Jack AI06F attendance machines.

Usage:
    python manage.py run_zk_push [--port 5005] [--host 0.0.0.0]

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

# ── REGISTER ACK strategy rotation ────────────────────────────────────────────
# Device RSTs with basic "echo + change cmd + checksum" approach.
# We try multiple strategies to discover what the device expects.
# Device reconnects every ~30ms so all strategies are tested quickly.
_register_strategy_counter = 0

REGISTER_STRATEGIES = [
    # ── ROUND 8: CHANGE THE FLOW + new cmd values in 16B ──
    # After 58+ content/size variations, ALL failed.
    # New approach: change the COMMUNICATION FLOW, not just content.
    "SERVER_FIRST",      # 0: Send 16B greeting IMMEDIATELY on connect, BEFORE device sends
    "TWO_SEGMENTS",      # 1: Split 16B into 8B + 8B with 10ms gap (different TCP segments)
    "ACK_THEN_CMD",      # 2: Send 16B ACK, wait 100ms, send second 16B
    "CMD_07D0",          # 3: cmd=0x07D0 (CMD_ACK_OK from standard ZK) in 16B
    "CMD_03E8",          # 4: cmd=0x03E8 (CMD_CONNECT from standard ZK) in 16B
    "REVERSED_MAGIC",    # 5: 5A A5 reversed magic in 16B
    "BOTH_SEQ_ZERO",     # 6: byte4=0, byte5=0, cmd=0x0002 in 16B
    "SESSION_ID",        # 7: bytes[8-11] = 0x00000001 (non-zero session) in 16B
    "HALF_CLOSE",        # 8: Send 16B ACK then shutdown write (half-close TCP)
    "NO_RESPONSE",       # 9: Control — send nothing
]


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
        global _register_strategy_counter
        ip = self.addr[0] if self.addr else 'unknown'
        logger.warning(f"[ZK-TCP] New connection from {ip}")

        # ── SERVER_FIRST: send greeting BEFORE device speaks ──
        strategy_idx = _register_strategy_counter % len(REGISTER_STRATEGIES)
        strategy = REGISTER_STRATEGIES[strategy_idx]
        if strategy == "SERVER_FIRST":
            _register_strategy_counter += 1
            logger.warning(f"[ZK-TCP] ▶ Strategy #{strategy_idx}: SERVER_FIRST — sending greeting before device speaks")
            # Build a generic 16B greeting: A5 5A + cmd=0x0002 + zeros
            greeting = bytearray(b'\xa5\x5a\x02\x00\x00\x00\x62\x31\x00\x00\x00\x00\x00\x01\x00\x02')
            _apply_checksum(greeting)
            greeting_bytes = bytes(greeting)
            logger.info(f"[ZK-TCP] Sending SERVER_FIRST 16B: {greeting_bytes.hex()}")
            await self._send(greeting_bytes)

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
        """Handle device registration — try multiple ACK strategies."""
        global _register_strategy_counter

        strategy_idx = _register_strategy_counter % len(REGISTER_STRATEGIES)
        strategy = REGISTER_STRATEGIES[strategy_idx]
        _register_strategy_counter += 1

        logger.warning(f"[ZK-TCP] ★ Registration from SN={packet.serial_number} "
                       f"seq={packet.send_seq} recv_seq={packet.recv_seq} "
                       f"proto_ver={packet.proto_ver}")
        logger.info(f"[ZK-TCP] REGISTER raw ({len(packet.raw)}B): {packet.raw.hex()}")
        logger.warning(f"[ZK-TCP] ▶ Strategy #{strategy_idx}: {strategy}")

        self.registered = True
        self.serial_number = packet.serial_number
        await self._record_device_contact()

        # ── Strategies that were handled in handle() already ──
        if strategy == "SERVER_FIRST":
            # Already sent greeting in handle(). Now send another ACK after REGISTER.
            ack = bytearray(packet.raw[:16])
            struct.pack_into('<H', ack, 2, CMD_REGISTER_ACK)
            _apply_checksum(ack)
            ack_bytes = bytes(ack)
            logger.info(f"[ZK-TCP] SERVER_FIRST: additional ACK after REGISTER: {ack_bytes.hex()}")
            await self._send(ack_bytes)
            return

        # ── NO_RESPONSE: control — send nothing ──
        if strategy == "NO_RESPONSE":
            logger.warning(f"[ZK-TCP] Strategy NO_RESPONSE: sending nothing")
            return

        # ── TWO_SEGMENTS: split 16B into two TCP writes ──
        if strategy == "TWO_SEGMENTS":
            ack = bytearray(packet.raw[:16])
            struct.pack_into('<H', ack, 2, CMD_REGISTER_ACK)
            _apply_checksum(ack)
            part1 = bytes(ack[:8])
            part2 = bytes(ack[8:])
            logger.info(f"[ZK-TCP] TWO_SEGMENTS: sending 8B+8B: {part1.hex()} | {part2.hex()}")
            self.writer.write(part1)
            await self.writer.drain()
            await asyncio.sleep(0.01)  # 10ms gap between segments
            self.writer.write(part2)
            await self.writer.drain()
            return

        # ── ACK_THEN_CMD: send ACK, wait 100ms, send second packet ──
        if strategy == "ACK_THEN_CMD":
            ack = bytearray(packet.raw[:16])
            struct.pack_into('<H', ack, 2, CMD_REGISTER_ACK)
            _apply_checksum(ack)
            ack_bytes = bytes(ack)
            logger.info(f"[ZK-TCP] ACK_THEN_CMD: first 16B ACK: {ack_bytes.hex()}")
            await self._send(ack_bytes)
            await asyncio.sleep(0.1)  # 100ms gap
            # Second packet: cmd=0x0005 (ATTLOG request-like)
            cmd2 = bytearray(packet.raw[:16])
            struct.pack_into('<H', cmd2, 2, 0x0005)
            _apply_checksum(cmd2)
            cmd2_bytes = bytes(cmd2)
            logger.info(f"[ZK-TCP] ACK_THEN_CMD: second 16B cmd: {cmd2_bytes.hex()}")
            await self._send(cmd2_bytes)
            return

        # ── HALF_CLOSE: send 16B then shutdown write end ──
        if strategy == "HALF_CLOSE":
            ack = bytearray(packet.raw[:16])
            struct.pack_into('<H', ack, 2, CMD_REGISTER_ACK)
            _apply_checksum(ack)
            ack_bytes = bytes(ack)
            logger.info(f"[ZK-TCP] HALF_CLOSE: send 16B then shutdown write: {ack_bytes.hex()}")
            await self._send(ack_bytes)
            try:
                self.writer.write_eof()
                await self.writer.drain()
                logger.info(f"[ZK-TCP] HALF_CLOSE: write end shutdown, still reading")
            except Exception as e:
                logger.warning(f"[ZK-TCP] HALF_CLOSE: write_eof error: {e}")
            return

        # ── All remaining strategies: 16B with different content ──
        ack = bytearray(packet.raw[:16])

        if strategy == "CMD_07D0":
            # cmd=0x07D0 = CMD_ACK_OK in standard ZK protocol
            struct.pack_into('<H', ack, 2, 0x07D0)
            _apply_checksum(ack)

        elif strategy == "CMD_03E8":
            # cmd=0x03E8 = CMD_CONNECT in standard ZK protocol
            struct.pack_into('<H', ack, 2, 0x03E8)
            _apply_checksum(ack)

        elif strategy == "REVERSED_MAGIC":
            # Swap magic: 5A A5 instead of A5 5A
            struct.pack_into('<H', ack, 2, CMD_REGISTER_ACK)
            ack[0] = 0x5A
            ack[1] = 0xA5
            _apply_checksum(ack)

        elif strategy == "BOTH_SEQ_ZERO":
            # Zero both sequence bytes
            struct.pack_into('<H', ack, 2, CMD_REGISTER_ACK)
            ack[4] = 0x00
            ack[5] = 0x00
            _apply_checksum(ack)

        elif strategy == "SESSION_ID":
            # Non-zero session: bytes[8-11] = 0x00000001
            struct.pack_into('<H', ack, 2, CMD_REGISTER_ACK)
            struct.pack_into('<I', ack, 8, 1)  # session_id = 1
            _apply_checksum(ack)

        ack_bytes = bytes(ack)
        logger.info(f"[ZK-TCP] Sending 16B [{strategy}]: {ack_bytes.hex()}")
        await self._send(ack_bytes)

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

        # Send ACK
        self.server_seq = (self.server_seq + 1) & 0xFF
        ack = build_data_ack(packet, CMD_PUSH_ATTLOG_ACK, self.server_seq, saved)
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

        # ACK
        self.server_seq = (self.server_seq + 1) & 0xFF
        ack = build_data_ack(packet, CMD_PUSH_USERINFO_ACK, self.server_seq, 0)
        await self._send(ack)

    async def _handle_operlog(self, packet):
        """Handle operation log push."""
        logger.info(f"[ZK-TCP] OPERLOG from SN={self.serial_number} "
                     f"payload={len(packet.payload)}B")

        self.server_seq = (self.server_seq + 1) & 0xFF
        ack = build_data_ack(packet, CMD_PUSH_OPERLOG_ACK, self.server_seq, 0)
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

    def __init__(self, host='0.0.0.0', port=5005):
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
        parser.add_argument('--port', type=int, default=5005, help='TCP port (default: 5005)')

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
