"""
ZK Push Protocol v2 — Binary Packet Parser & Builder
=====================================================

Ronald Jack AI06F (SN: ZXRC13013923) uses ZK Push binary protocol
instead of ADMS/iclock HTTP. This module parses and builds binary packets.

Protocol analysis from nginx logs (machine sending to port 80, getting 400):

  Registration packet (36 bytes):
    Offset  Size  Description
    0-1     2     Magic: 0xA5 0x5A
    2-3     2     Command (uint16 LE): 0x0001 = registration
    4       1     Send sequence counter (increments per packet)
    5-7     3     Protocol ID: "kb1"
    8-11    4     Session (zeros for initial)
    12      1     Reserved
    13      1     Version/flags (0x01)
    14      1     Receive sequence counter
    15      1     Protocol version (0x02)
    16-35   20    Serial number (ASCII, null-padded)

The device sends registration packets repeatedly with incrementing
sequence numbers until it receives a valid ACK response.
"""
import struct
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List

logger = logging.getLogger('attendance.zk_push')

# ── Constants ──────────────────────────────────────────────────────────────────

MAGIC = b'\xa5\x5a'
HEADER_SIZE = 36
SN_OFFSET = 16
SN_SIZE = 20

# Command IDs (uint16 LE)
CMD_REGISTER = 0x0001           # Device → Server: registration
CMD_REGISTER_ACK = 0x0002       # Server → Device: registration ACK
CMD_HEARTBEAT = 0x0003          # Device → Server: keep-alive
CMD_HEARTBEAT_ACK = 0x0004      # Server → Device: keep-alive ACK
CMD_PUSH_ATTLOG = 0x0005        # Device → Server: attendance records
CMD_PUSH_ATTLOG_ACK = 0x0006    # Server → Device: attendance ACK
CMD_PUSH_USERINFO = 0x0007      # Device → Server: user data
CMD_PUSH_USERINFO_ACK = 0x0008  # Server → Device: user data ACK
CMD_PUSH_OPERLOG = 0x0009       # Device → Server: operation log
CMD_PUSH_OPERLOG_ACK = 0x000A   # Server → Device: operation log ACK

# Command name mapping for logging
CMD_NAMES = {
    CMD_REGISTER: 'REGISTER',
    CMD_REGISTER_ACK: 'REGISTER_ACK',
    CMD_HEARTBEAT: 'HEARTBEAT',
    CMD_HEARTBEAT_ACK: 'HEARTBEAT_ACK',
    CMD_PUSH_ATTLOG: 'PUSH_ATTLOG',
    CMD_PUSH_ATTLOG_ACK: 'PUSH_ATTLOG_ACK',
    CMD_PUSH_USERINFO: 'PUSH_USERINFO',
    CMD_PUSH_USERINFO_ACK: 'PUSH_USERINFO_ACK',
    CMD_PUSH_OPERLOG: 'PUSH_OPERLOG',
    CMD_PUSH_OPERLOG_ACK: 'PUSH_OPERLOG_ACK',
}

# ZK epoch: 2000-01-01 00:00:00 UTC (seconds between Unix epoch and ZK epoch)
ZK_EPOCH_OFFSET = 946684800

# Attendance record size (common ZK binary formats)
ATTLOG_RECORD_SIZES = [8, 12, 16, 40]  # Varies by firmware


# ── Data Classes ───────────────────────────────────────────────────────────────

@dataclass
class ZKPacket:
    """Parsed ZK Push Protocol packet."""
    raw: bytes
    command: int
    send_seq: int       # byte 4: device's send counter
    recv_seq: int       # byte 5: device's receive counter
    proto_ver: bytes    # bytes 6-7: protocol version (e.g. b'b1')
    session: bytes
    flags: bytes
    serial_number: str
    payload: bytes = b''

    @property
    def proto_id(self):
        """Legacy: combine recv_seq char + proto_ver for display."""
        return bytes([self.recv_seq]) + self.proto_ver

    @property
    def cmd_name(self):
        return CMD_NAMES.get(self.command, f'UNKNOWN_0x{self.command:04X}')

    @property
    def has_payload(self):
        return len(self.payload) > 0

    def hex_dump(self, max_bytes=64):
        data = self.raw[:max_bytes]
        hex_str = ' '.join(f'{b:02X}' for b in data)
        if len(self.raw) > max_bytes:
            hex_str += f' ... ({len(self.raw)} bytes total)'
        return hex_str


@dataclass
class AttendanceRecord:
    """Parsed attendance record from binary data."""
    user_id: str
    timestamp: datetime
    status: int = 0
    punch: int = 0
    verify_mode: int = 0


# ── Packet Parsing ─────────────────────────────────────────────────────────────

def find_packets(data: bytes) -> List[tuple]:
    """Find all A5 5A packet boundaries in a data buffer.

    Returns list of (start_offset, packet_data) tuples.
    Since we don't know exact packet boundaries for data packets,
    we find all magic headers and split accordingly.
    """
    packets = []
    i = 0
    while i < len(data) - 1:
        if data[i:i+2] == MAGIC:
            # Find next magic or end of data
            next_magic = data.find(MAGIC, i + 2)
            if next_magic == -1:
                packets.append((i, data[i:]))
            else:
                packets.append((i, data[i:next_magic]))
            i = next_magic if next_magic != -1 else len(data)
        else:
            i += 1
    return packets


def parse_packet(data: bytes) -> Optional[ZKPacket]:
    """Parse a single ZK Push Protocol packet."""
    if len(data) < 4:
        return None

    if data[:2] != MAGIC:
        return None

    command = struct.unpack_from('<H', data, 2)[0]
    send_seq = data[4] if len(data) > 4 else 0
    recv_seq = data[5] if len(data) > 5 else 0
    proto_ver = data[6:8] if len(data) >= 8 else b'b1'
    session = data[8:12] if len(data) >= 12 else b'\x00' * 4
    flags = data[12:16] if len(data) >= 16 else b'\x00' * 4

    # Extract serial number (bytes 16-35, null-terminated ASCII)
    serial_number = ''
    if len(data) >= SN_OFFSET + SN_SIZE:
        sn_raw = data[SN_OFFSET:SN_OFFSET + SN_SIZE]
        serial_number = sn_raw.split(b'\x00')[0].decode('ascii', errors='replace')

    # Everything after header is payload
    payload = data[HEADER_SIZE:] if len(data) > HEADER_SIZE else b''

    return ZKPacket(
        raw=data,
        command=command,
        send_seq=send_seq,
        recv_seq=recv_seq,
        proto_ver=proto_ver,
        session=session,
        flags=flags,
        serial_number=serial_number,
        payload=payload,
    )


# ── Response Building ──────────────────────────────────────────────────────────

def build_response(packet: ZKPacket, resp_cmd: int, server_seq: int = 0, payload: bytes = b'') -> bytes:
    """Build a response packet with correct sequence handling."""
    header = bytearray(HEADER_SIZE)

    # Magic
    header[0:2] = MAGIC

    # Response command
    struct.pack_into('<H', header, 2, resp_cmd)

    # Sequence counters (critical for device acceptance)
    header[4] = server_seq & 0xFF          # Server's own send counter
    header[5] = packet.send_seq & 0xFF     # Acknowledge device's send_seq

    # Protocol version (bytes 6-7)
    pv = packet.proto_ver if len(packet.proto_ver) >= 2 else b'b1'
    header[6:8] = pv[:2]

    # Mirror session
    if len(packet.session) >= 4:
        header[8:12] = packet.session[:4]

    # Mirror flags
    if len(packet.flags) >= 4:
        header[12:16] = packet.flags[:4]

    # Serial number
    sn_bytes = packet.serial_number.encode('ascii')[:SN_SIZE]
    header[SN_OFFSET:SN_OFFSET + len(sn_bytes)] = sn_bytes

    return bytes(header) + payload


def build_register_ack(packet: ZKPacket, server_seq: int = 0) -> bytes:
    """Build registration ACK by echoing the raw device packet.

    Only the command bytes (offset 2-3) are changed from
    REGISTER(0x0001) to REGISTER_ACK(0x0002).
    All other header fields and payload are preserved exactly
    as received — this ensures maximum firmware compatibility.
    """
    ack = bytearray(packet.raw)
    struct.pack_into('<H', ack, 2, CMD_REGISTER_ACK)
    return bytes(ack)


def build_heartbeat_ack(packet: ZKPacket, server_seq: int = 0) -> bytes:
    """Build heartbeat ACK."""
    return build_response(packet, CMD_HEARTBEAT_ACK, server_seq)


def build_data_ack(packet: ZKPacket, cmd_ack: int, server_seq: int = 0, count: int = 0) -> bytes:
    """Build data push ACK with record count."""
    count_payload = struct.pack('<I', count)
    return build_response(packet, cmd_ack, server_seq, count_payload)


# ── Attendance Data Parsing ────────────────────────────────────────────────────

def parse_attlog_payload(payload: bytes, sn: str = '') -> List[AttendanceRecord]:
    """Try to parse attendance records from binary payload.

    Multiple formats are tried since ZK firmware varies:

    Format A (8 bytes per record):
      user_id: uint16 LE (2 bytes)
      timestamp: uint32 LE (4 bytes, seconds since 2000-01-01)
      status: uint8 (1 byte)
      punch: uint8 (1 byte)

    Format B (16 bytes per record):
      user_id: uint32 LE (4 bytes)
      timestamp: uint32 LE (4 bytes)
      status: uint8 (1 byte)
      punch: uint8 (1 byte)
      reserved: 6 bytes

    Format C (40 bytes per record - newer firmware):
      user_id: 9 bytes (null-padded string)
      timestamp: uint32 LE (4 bytes)
      status: uint8 (1 byte)
      punch: uint8 (1 byte)
      reserved: 25 bytes
    """
    records = []

    if not payload or len(payload) < 8:
        return records

    # ZK epoch: 2000-01-01 00:00:00 UTC
    ZK_EPOCH = datetime(2000, 1, 1).timestamp()

    # Try each format
    for record_size, parser in [
        (40, _parse_attlog_40),
        (16, _parse_attlog_16),
        (8, _parse_attlog_8),
    ]:
        if len(payload) >= record_size and len(payload) % record_size == 0:
            parsed = parser(payload, ZK_EPOCH)
            if parsed:
                logger.info(f"[ZK-PUSH] Parsed {len(parsed)} ATTLOG records "
                            f"(format={record_size}B) from SN={sn}")
                return parsed

    # Fallback: try to find any recognizable timestamp patterns
    logger.warning(f"[ZK-PUSH] Could not parse ATTLOG payload "
                   f"({len(payload)} bytes) from SN={sn}")
    logger.warning(f"[ZK-PUSH] Payload hex: {payload[:80].hex()}")
    return records


def _parse_attlog_8(payload: bytes, zk_epoch: float) -> List[AttendanceRecord]:
    """Parse 8-byte attendance records."""
    records = []
    for i in range(0, len(payload), 8):
        chunk = payload[i:i+8]
        if len(chunk) < 8:
            break
        user_id = struct.unpack_from('<H', chunk, 0)[0]
        raw_ts = struct.unpack_from('<I', chunk, 2)[0]
        status = chunk[6]
        punch = chunk[7]
        ts = _decode_zk_timestamp(raw_ts, zk_epoch)
        if ts and _is_valid_timestamp(ts):
            records.append(AttendanceRecord(
                user_id=str(user_id),
                timestamp=ts,
                status=status,
                punch=punch,
            ))
    return records if _records_look_valid(records) else []


def _parse_attlog_16(payload: bytes, zk_epoch: float) -> List[AttendanceRecord]:
    """Parse 16-byte attendance records."""
    records = []
    for i in range(0, len(payload), 16):
        chunk = payload[i:i+16]
        if len(chunk) < 16:
            break
        user_id = struct.unpack_from('<I', chunk, 0)[0]
        raw_ts = struct.unpack_from('<I', chunk, 4)[0]
        status = chunk[8]
        punch = chunk[9]
        ts = _decode_zk_timestamp(raw_ts, zk_epoch)
        if ts and _is_valid_timestamp(ts):
            records.append(AttendanceRecord(
                user_id=str(user_id),
                timestamp=ts,
                status=status,
                punch=punch,
            ))
    return records if _records_look_valid(records) else []


def _parse_attlog_40(payload: bytes, zk_epoch: float) -> List[AttendanceRecord]:
    """Parse 40-byte attendance records (newer firmware)."""
    records = []
    for i in range(0, len(payload), 40):
        chunk = payload[i:i+40]
        if len(chunk) < 40:
            break
        # User ID as null-terminated string (first 9 bytes)
        uid_raw = chunk[0:9].split(b'\x00')[0]
        user_id = uid_raw.decode('ascii', errors='replace').strip()
        if not user_id:
            continue
        raw_ts = struct.unpack_from('<I', chunk, 12)[0]
        status = chunk[10]
        punch = chunk[11]
        ts = _decode_zk_timestamp(raw_ts, zk_epoch)
        if ts and _is_valid_timestamp(ts):
            records.append(AttendanceRecord(
                user_id=user_id,
                timestamp=ts,
                status=status,
                punch=punch,
            ))
    return records if _records_look_valid(records) else []


# Also try parsing attendance from text embedded in binary
def parse_attlog_text_in_binary(payload: bytes, sn: str = '') -> List[AttendanceRecord]:
    """Some firmware embeds tab-separated text within binary frames."""
    records = []
    try:
        text = payload.decode('utf-8', errors='ignore')
        for line in text.split('\n'):
            line = line.strip('\r\n\t\x00 ')
            if not line:
                continue
            parts = line.split('\t')
            if len(parts) >= 2:
                try:
                    user_id = parts[0].strip()
                    ts_str = parts[1].strip().replace('/', '-')
                    ts = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S')
                    status = int(parts[2]) if len(parts) > 2 else 0
                    punch = int(parts[3]) if len(parts) > 3 else 0
                    records.append(AttendanceRecord(
                        user_id=user_id,
                        timestamp=ts,
                        status=status,
                        punch=punch,
                    ))
                except (ValueError, IndexError):
                    continue
    except Exception:
        pass
    return records


# ── Helpers ────────────────────────────────────────────────────────────────────

def _decode_zk_timestamp(raw: int, zk_epoch: float) -> Optional[datetime]:
    """Decode ZK timestamp (seconds since 2000-01-01)."""
    if raw == 0:
        return None
    try:
        # Method 1: direct offset from ZK epoch
        ts = datetime.fromtimestamp(zk_epoch + raw)
        if _is_valid_timestamp(ts):
            return ts

        # Method 2: ZK encoded timestamp (packed date fields)
        # Some firmware encodes as: ((year-2000)*12*31+month*31+day)*24*60*60 + hour*3600+min*60+sec
        second = raw % 60
        raw //= 60
        minute = raw % 60
        raw //= 60
        hour = raw % 24
        raw //= 24
        day = (raw % 31) + 1
        raw //= 31
        month = (raw % 12) + 1
        year = (raw // 12) + 2000
        ts = datetime(year, month, day, hour, minute, second)
        if _is_valid_timestamp(ts):
            return ts
    except (ValueError, OverflowError, OSError):
        return None
    return None


def _is_valid_timestamp(ts: datetime) -> bool:
    """Check if timestamp is reasonable (between 2020 and 2030)."""
    return 2020 <= ts.year <= 2030


def _records_look_valid(records: List[AttendanceRecord]) -> bool:
    """Heuristic: check if parsed records look valid."""
    if not records:
        return False
    valid = sum(1 for r in records if r.timestamp and _is_valid_timestamp(r.timestamp))
    return valid >= len(records) * 0.5  # At least 50% should have valid timestamps
