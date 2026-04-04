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


@dataclass
class UserRecord:
    """Parsed user record from USERINFO push payload."""
    uid: int          # Internal device UID (integer)
    user_id: str      # User ID string on device (e.g. "13", "80")
    name: str         # Display name
    privilege: int = 0
    card: int = 0


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

def _compute_checksum(data: bytes) -> int:
    """Compute A5 5A protocol checksum.

    byte[14] = sum(bytes[2] through bytes[12]) & 0xFF

    Verified against 10+ real device packets from Ronald Jack AI06F
    (SN=ZXRC13013923).
    """
    return sum(data[2:13]) & 0xFF


def _apply_checksum(data: bytearray) -> bytearray:
    """Recompute and set checksum byte at offset 14."""
    if len(data) >= 15:
        data[14] = _compute_checksum(data)
    return data


def build_register_ack(packet: ZKPacket, server_seq: int = 0) -> bytes:
    """Build registration ACK by echoing the raw device packet.

    Changes:
      1. Command (bytes 2-3): REGISTER(0x0001) → REGISTER_ACK(0x0002)
      2. Checksum (byte 14): Recomputed to match new command

    All other header fields and payload are preserved exactly
    as received — this ensures maximum firmware compatibility.
    """
    ack = bytearray(packet.raw)
    struct.pack_into('<H', ack, 2, CMD_REGISTER_ACK)
    _apply_checksum(ack)
    return bytes(ack)


def build_heartbeat_ack(packet: ZKPacket, server_seq: int = 0) -> bytes:
    """Build heartbeat ACK by echoing and changing cmd + checksum."""
    ack = bytearray(packet.raw)
    struct.pack_into('<H', ack, 2, CMD_HEARTBEAT_ACK)
    _apply_checksum(ack)
    return bytes(ack)


def build_data_ack(packet: ZKPacket, cmd_ack: int, server_seq: int = 0, count: int = 0) -> bytes:
    """Build data push ACK by echoing and changing cmd + checksum."""
    ack = bytearray(packet.raw)
    struct.pack_into('<H', ack, 2, cmd_ack)
    _apply_checksum(ack)
    return bytes(ack)


def build_response(packet: ZKPacket, resp_cmd: int, server_seq: int = 0, payload: bytes = b'') -> bytes:
    """Build a generic response (fallback for unknown commands)."""
    ack = bytearray(packet.raw)
    struct.pack_into('<H', ack, 2, resp_cmd)
    _apply_checksum(ack)
    return bytes(ack)


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


# ── User Info Parsing ──────────────────────────────────────────────────────────

def parse_userinfo_payload(payload: bytes, sn: str = '') -> List[UserRecord]:
    """Parse user records from CMD_PUSH_USERINFO (0x0007) payload.

    The device pushes this packet on each connection, containing all enrolled
    users with their UID, user_id string, and display name.

    Tries formats in order:
    1. Text/tab-separated (most common in ZK Push ADMS-family)
    2. Binary 48-byte records (ZKTeco standard)
    3. Binary 72-byte records (newer firmware)
    4. Binary 56-byte records
    """
    if not payload:
        return []

    # ── Format 1: Text lines (tab or comma separated) ────────────────────────
    records = _parse_userinfo_text(payload, sn)
    if records:
        return records

    # ── Format 2: Binary 48-byte records ─────────────────────────────────────
    if len(payload) >= 48 and len(payload) % 48 == 0:
        records = _parse_userinfo_binary(payload, sn, record_size=48,
                                         uid_size=2, userid_size=9, name_size=24,
                                         pass_size=8, card_offset=43)
        if records:
            logger.info(f"[ZK-PUSH] Parsed {len(records)} USERINFO records "
                        f"(format=48B) from SN={sn}")
            return records

    # ── Format 3: Binary 72-byte records ─────────────────────────────────────
    if len(payload) >= 72 and len(payload) % 72 == 0:
        records = _parse_userinfo_binary(payload, sn, record_size=72,
                                         uid_size=2, userid_size=9, name_size=24,
                                         pass_size=8, card_offset=43)
        if records:
            logger.info(f"[ZK-PUSH] Parsed {len(records)} USERINFO records "
                        f"(format=72B) from SN={sn}")
            return records

    # ── Format 4: Binary 56-byte records ─────────────────────────────────────
    if len(payload) >= 56 and len(payload) % 56 == 0:
        records = _parse_userinfo_binary(payload, sn, record_size=56,
                                         uid_size=2, userid_size=9, name_size=24,
                                         pass_size=8, card_offset=43)
        if records:
            logger.info(f"[ZK-PUSH] Parsed {len(records)} USERINFO records "
                        f"(format=56B) from SN={sn}")
            return records

    logger.warning(f"[ZK-PUSH] Could not parse USERINFO payload "
                   f"({len(payload)} bytes) from SN={sn}")
    logger.warning(f"[ZK-PUSH] USERINFO hex: {payload[:120].hex()}")
    return []


def _parse_userinfo_text(payload: bytes, sn: str = '') -> List[UserRecord]:
    """Parse tab-separated or space-separated user records embedded in payload.

    Common ZK Push text format (one user per line):
      <uid>\\t<user_id>\\t<name>\\t<password>\\t<card>\\t<privilege>\\n

    Some devices omit uid or password fields.
    """
    records = []
    try:
        # Try UTF-8 first, then GBK (Chinese encoding used by ZKTeco)
        for encoding in ('utf-8', 'gbk', 'latin-1'):
            try:
                text = payload.decode(encoding, errors='strict')
                break
            except (UnicodeDecodeError, LookupError):
                continue
        else:
            text = payload.decode('utf-8', errors='ignore')

        for line in text.splitlines():
            line = line.strip('\r\n\t\x00 ')
            if not line:
                continue
            parts = line.split('\t')
            if len(parts) < 2:
                parts = line.split(',')
            if len(parts) < 2:
                continue
            try:
                # Try: uid, user_id, name, [password, card, privilege]
                if len(parts) >= 3:
                    uid = int(parts[0].strip())
                    user_id = parts[1].strip()
                    name = parts[2].strip()
                    privilege = int(parts[5].strip()) if len(parts) > 5 else 0
                    card = int(parts[4].strip()) if len(parts) > 4 else 0
                else:
                    # Minimal: user_id, name
                    uid = 0
                    user_id = parts[0].strip()
                    name = parts[1].strip()
                    privilege = 0
                    card = 0

                if user_id and name:
                    records.append(UserRecord(
                        uid=uid,
                        user_id=user_id,
                        name=name,
                        privilege=privilege,
                        card=card,
                    ))
            except (ValueError, IndexError):
                continue
    except Exception:
        pass

    if records:
        logger.info(f"[ZK-PUSH] Parsed {len(records)} USERINFO records "
                    f"(text format) from SN={sn}")
    return records


def _parse_userinfo_binary(payload: bytes, sn: str, record_size: int,
                            uid_size: int, userid_size: int, name_size: int,
                            pass_size: int, card_offset: int) -> List[UserRecord]:
    """Parse fixed-size binary user records.

    Layout (offsets from record start):
      0            : uid (uint16 or uint32 LE)
      uid_size     : user_id (null-padded ASCII)
      uid+userid   : name (null-padded, may be GBK)
      ...
      card_offset  : card (uint32 LE)
      card_offset+4: privilege (uint8)
    """
    records = []
    uid_fmt = '<H' if uid_size == 2 else '<I'

    for i in range(0, len(payload), record_size):
        chunk = payload[i:i + record_size]
        if len(chunk) < record_size:
            break
        try:
            uid = struct.unpack_from(uid_fmt, chunk, 0)[0]
            user_id_raw = chunk[uid_size:uid_size + userid_size].split(b'\x00')[0]
            user_id = user_id_raw.decode('ascii', errors='replace').strip()

            name_start = uid_size + userid_size
            name_raw = chunk[name_start:name_start + name_size].split(b'\x00')[0]
            # Try GBK (ZKTeco Chinese) then UTF-8
            for enc in ('gbk', 'utf-8', 'latin-1'):
                try:
                    name = name_raw.decode(enc, errors='strict').strip()
                    break
                except (UnicodeDecodeError, LookupError):
                    continue
            else:
                name = name_raw.decode('utf-8', errors='replace').strip()

            card = struct.unpack_from('<I', chunk, card_offset)[0] if card_offset + 4 <= record_size else 0
            privilege = chunk[card_offset + 4] if card_offset + 5 <= record_size else 0

            if user_id or uid:
                records.append(UserRecord(
                    uid=uid,
                    user_id=user_id or str(uid),
                    name=name,
                    privilege=privilege,
                    card=card,
                ))
        except Exception:
            continue

    return records
