#!/usr/bin/env python3
"""
Test ATTLOG Simulation — Giả lập máy chấm công gửi dữ liệu chấm công
=======================================================================

Kết nối tới VPS port 7005, giả lập:
1. REGISTER (đăng ký) → nhận ACK
2. Gửi ATTLOG (bản ghi chấm công giả) → nhận ACK

Dùng để test pipeline nhận chấm công: TCP → parse → DB → WebSocket → UI

Cách dùng:
    python deploy/test_attlog_simulation.py [--host 123.30.48.72] [--port 7005]
    python deploy/test_attlog_simulation.py --host 127.0.0.1  # test local
"""
import argparse
import socket
import struct
import time
from datetime import datetime


def build_register_packet(seq=1, sn='TESTSIM001'):
    """Build a 48-byte REGISTER packet like Ronald Jack AI06F."""
    pkt = bytearray(48)
    pkt[0:2] = b'\xa5\x5a'          # Magic
    pkt[2:4] = b'\x01\x00'          # Command = REGISTER (0x0001)
    pkt[4] = seq & 0xFF             # send_seq
    pkt[5] = 0xC8                   # recv_seq
    pkt[6:8] = b'\x62\x31'          # proto_ver = "b1"
    pkt[8:12] = b'\x00\x00\x00\x00' # session
    pkt[12] = 0x00                   # flags
    pkt[13] = 0x01
    pkt[14] = 0x00                   # checksum placeholder
    pkt[15] = 0x02                   # footer

    # Serial number at offset 16 (20 bytes, null-padded)
    sn_bytes = sn.encode('ascii')[:20]
    pkt[16:16+len(sn_bytes)] = sn_bytes

    # Compute checksum: sum(bytes[0..13]) & 0xFF
    pkt[14] = sum(pkt[0:14]) & 0xFF
    return bytes(pkt)


def build_attlog_text_packet(seq, sn='TESTSIM001', user_id='1',
                              timestamp=None, status=0, punch=0):
    """Build ATTLOG packet with text payload (tab-separated).

    Format: user_id\\ttimestamp\\tstatus\\tpunch\\n
    This matches `parse_attlog_text_in_binary` in zk_push_protocol.py.
    """
    if timestamp is None:
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Text payload
    text_payload = f"{user_id}\t{timestamp}\t{status}\t{punch}\n"
    payload_bytes = text_payload.encode('utf-8')

    # Build header (16 bytes) + serial (20 bytes) + payload
    header_size = 36
    total_size = header_size + len(payload_bytes)

    pkt = bytearray(total_size)
    pkt[0:2] = b'\xa5\x5a'
    pkt[2:4] = struct.pack('<H', 0x0005)  # CMD_PUSH_ATTLOG
    pkt[4] = seq & 0xFF
    pkt[5] = 0xC8
    pkt[6:8] = b'\x62\x31'
    pkt[8:12] = b'\x00\x00\x00\x00'
    pkt[12] = 0x00
    pkt[13] = 0x01
    pkt[14] = 0x00  # checksum placeholder
    pkt[15] = 0x02

    sn_bytes = sn.encode('ascii')[:20]
    pkt[16:16+len(sn_bytes)] = sn_bytes

    # Append text payload after header
    pkt[header_size:] = payload_bytes

    pkt[14] = sum(pkt[0:14]) & 0xFF
    return bytes(pkt)


def build_attlog_binary_packet(seq, sn='TESTSIM001', user_id=1,
                                timestamp=None, status=0, punch=0):
    """Build ATTLOG with 8-byte binary record format.

    Record: uint16_LE(user_id) + uint32_LE(zk_timestamp) + uint8(status) + uint8(punch)
    """
    if timestamp is None:
        timestamp = datetime.now()

    # ZK epoch: 2000-01-01 00:00:00
    zk_epoch = datetime(2000, 1, 1)
    zk_ts = int((timestamp - zk_epoch).total_seconds())

    record = struct.pack('<H', user_id)      # 2 bytes
    record += struct.pack('<I', zk_ts)       # 4 bytes
    record += struct.pack('B', status)       # 1 byte
    record += struct.pack('B', punch)        # 1 byte
    # Total: 8 bytes

    header_size = 36
    total_size = header_size + len(record)

    pkt = bytearray(total_size)
    pkt[0:2] = b'\xa5\x5a'
    pkt[2:4] = struct.pack('<H', 0x0005)
    pkt[4] = seq & 0xFF
    pkt[5] = 0xC8
    pkt[6:8] = b'\x62\x31'
    pkt[8:12] = b'\x00\x00\x00\x00'
    pkt[12] = 0x00
    pkt[13] = 0x01
    pkt[14] = 0x00
    pkt[15] = 0x02

    sn_bytes = sn.encode('ascii')[:20]
    pkt[16:16+len(sn_bytes)] = sn_bytes

    pkt[header_size:] = record

    pkt[14] = sum(pkt[0:14]) & 0xFF
    return bytes(pkt)


def hex_dump(data):
    return ' '.join(f'{b:02x}' for b in data)


def main():
    parser = argparse.ArgumentParser(description='Test ATTLOG simulation')
    parser.add_argument('--host', default='123.30.48.72', help='VPS host')
    parser.add_argument('--port', type=int, default=7005, help='TCP port')
    parser.add_argument('--sn', default='TESTSIM001', help='Simulated SN')
    parser.add_argument('--user-id', default='1', help='User ID for punch')
    args = parser.parse_args()

    now = datetime.now()
    ts_str = now.strftime('%Y-%m-%d %H:%M:%S')

    print(f"╔══════════════════════════════════════════════════╗")
    print(f"║  ATTLOG Simulation Test                         ║")
    print(f"║  Target: {args.host}:{args.port:<24}       ║")
    print(f"║  SN: {args.sn:<38}   ║")
    print(f"╚══════════════════════════════════════════════════╝")
    print()

    # ── Step 1: Connect ──────────────────────────────────────────────
    print(f"[1] Connecting to {args.host}:{args.port}...")
    try:
        sock = socket.create_connection((args.host, args.port), timeout=10)
    except Exception as e:
        print(f"    ✗ Connection failed: {e}")
        return
    print(f"    ✓ Connected!")
    print()

    # ── Step 2: Send REGISTER ────────────────────────────────────────
    seq = 10
    reg_pkt = build_register_packet(seq=seq, sn=args.sn)
    print(f"[2] Sending REGISTER ({len(reg_pkt)}B):")
    print(f"    → {hex_dump(reg_pkt[:16])}")
    sock.sendall(reg_pkt)

    # Wait for ACK
    try:
        ack = sock.recv(1024)
        print(f"    ← ACK ({len(ack)}B): {hex_dump(ack)}")
        if len(ack) >= 16 and ack[0:2] == b'\x5a\xa5':
            print(f"    ✓ REGISTER ACK received!")
        else:
            print(f"    ✗ Unexpected ACK format")
    except socket.timeout:
        print(f"    ✗ No ACK received (timeout)")
        sock.close()
        return
    print()

    time.sleep(1)

    # ── Step 3: Send ATTLOG (text format) ────────────────────────────
    seq += 3
    attlog_text = build_attlog_text_packet(
        seq=seq, sn=args.sn,
        user_id=args.user_id,
        timestamp=ts_str,
        status=0, punch=0,
    )
    print(f"[3] Sending ATTLOG text format ({len(attlog_text)}B):")
    print(f"    Payload: user={args.user_id} time={ts_str}")
    print(f"    → {hex_dump(attlog_text[:48])}")
    if len(attlog_text) > 48:
        print(f"      {hex_dump(attlog_text[48:])}")
    sock.sendall(attlog_text)

    try:
        ack = sock.recv(1024)
        print(f"    ← ACK ({len(ack)}B): {hex_dump(ack)}")
        if len(ack) >= 2 and ack[0:2] == b'\x5a\xa5':
            print(f"    ✓ ATTLOG ACK received!")
        else:
            print(f"    ✗ Unexpected response")
    except socket.timeout:
        print(f"    ✗ No ACK received")
    print()

    time.sleep(1)

    # ── Step 4: Send ATTLOG (binary 8-byte format) ───────────────────
    seq += 3
    attlog_bin = build_attlog_binary_packet(
        seq=seq, sn=args.sn,
        user_id=int(args.user_id) if args.user_id.isdigit() else 1,
        timestamp=now,
        status=0, punch=1,  # punch=1 = clock out
    )
    print(f"[4] Sending ATTLOG binary format ({len(attlog_bin)}B):")
    print(f"    Payload: user={args.user_id} time={ts_str} punch=1 (out)")
    print(f"    → {hex_dump(attlog_bin)}")
    sock.sendall(attlog_bin)

    try:
        ack = sock.recv(1024)
        print(f"    ← ACK ({len(ack)}B): {hex_dump(ack)}")
        if len(ack) >= 2 and ack[0:2] == b'\x5a\xa5':
            print(f"    ✓ ATTLOG ACK received!")
        else:
            print(f"    ✗ Unexpected response")
    except socket.timeout:
        print(f"    ✗ No ACK received")
    print()

    # ── Done ─────────────────────────────────────────────────────────
    print(f"[5] Test complete!")
    print(f"    Check VPS logs: docker compose logs backend --tail 20")
    print(f"    Check web UI: https://hrmgo.site → Live Monitor")
    sock.close()


if __name__ == '__main__':
    main()
