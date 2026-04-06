"""
Sync script: Pull attendance from ZKTeco device via LAN → Push to VPS.

Chạy trên PC Local (cùng mạng LAN với máy chấm công).
Dùng thư viện pyzk để kết nối trực tiếp đến máy chấm công qua TCP/4370,
lấy attendance logs + employee list, rồi gửi lên VPS qua HTTPS API.

Cách dùng:
  pip install pyzk requests
  python local_sync.py

Hoặc chạy với tham số:
  python local_sync.py --device-ip 192.168.1.225 --api-url https://api.hrmgo.site --interval 60
"""
import os
import sys
import time
import json
import logging
import argparse
from datetime import datetime, timedelta

try:
    import requests
except ImportError:
    print("ERROR: Cần cài requests: pip install requests")
    sys.exit(1)

try:
    from zk import ZK
except ImportError:
    print("ERROR: Cần cài pyzk: pip install pyzk")
    sys.exit(1)

# ── Configuration ────────────────────────────────────────────────────────────

# Đọc từ environment hoặc dùng default
DEVICE_IP       = os.getenv('ZK_DEVICE_IP', '192.168.1.225')
DEVICE_PORT     = int(os.getenv('ZK_DEVICE_PORT', '4370'))
DEVICE_PASSWORD  = int(os.getenv('ZK_DEVICE_PASSWORD', '0'))
DEVICE_TIMEOUT   = int(os.getenv('ZK_DEVICE_TIMEOUT', '10'))

API_BASE_URL    = os.getenv('SYNC_API_URL', 'https://api.hrmgo.site')
SYNC_KEY        = os.getenv('SYNC_KEY', '')
SYNC_INTERVAL   = int(os.getenv('SYNC_INTERVAL', '60'))  # seconds

# File lưu timestamp lần sync cuối → chỉ gửi records mới
STATE_FILE      = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.last_sync_state.json')

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
logger = logging.getLogger('local_sync')


def load_state():
    """Load last sync timestamp from state file."""
    try:
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, 'r') as f:
                data = json.load(f)
            return datetime.fromisoformat(data.get('last_attendance_ts', '2000-01-01T00:00:00'))
    except Exception as e:
        logger.warning(f"Could not load state: {e}")
    return datetime(2000, 1, 1)


def save_state(last_ts):
    """Save last sync timestamp to state file."""
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump({'last_attendance_ts': last_ts.isoformat()}, f)
    except Exception as e:
        logger.warning(f"Could not save state: {e}")


def connect_device(ip, port, password, timeout):
    """Connect to ZKTeco device via pyzk."""
    zk = ZK(ip, port=port, timeout=timeout, password=password, force_udp=False)
    conn = zk.connect()
    logger.info(f"Connected to device {ip}:{port}")
    return conn


def pull_attendance(conn, since_ts):
    """Pull attendance records from device, filter by timestamp > since_ts."""
    attendance = conn.get_attendance()
    if not attendance:
        return []

    new_records = []
    for att in attendance:
        # att.timestamp is a datetime object
        if att.timestamp > since_ts:
            new_records.append({
                'user_id': str(att.user_id),
                'timestamp': att.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
                'status': att.status,
                'punch': att.punch,
            })

    # Sort by timestamp
    new_records.sort(key=lambda r: r['timestamp'])
    return new_records


def pull_employees(conn):
    """Pull user/employee list from device."""
    users = conn.get_users()
    if not users:
        return []

    employees = []
    for u in users:
        employees.append({
            'uid': u.uid,
            'user_id': str(u.user_id),
            'name': u.name or f'User {u.user_id}',
            'privilege': u.privilege,
            'group_id': str(u.group_id) if hasattr(u, 'group_id') else '',
            'card': u.card if hasattr(u, 'card') else 0,
        })

    return employees


def push_attendance(records, api_url, sync_key):
    """Push attendance records to VPS API."""
    url = f"{api_url}/api/attendance/local-sync/attendance/"
    headers = {
        'Content-Type': 'application/json',
        'X-Sync-Key': sync_key,
    }

    # Send in batches of 200
    batch_size = 200
    total_saved = 0
    total_skipped = 0

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        try:
            resp = requests.post(url, json={'records': batch}, headers=headers, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                total_saved += data.get('saved', 0)
                total_skipped += data.get('skipped', 0)
                logger.info(f"  Batch {i // batch_size + 1}: saved={data.get('saved')}, skipped={data.get('skipped')}")
            else:
                logger.error(f"  Batch {i // batch_size + 1} failed: HTTP {resp.status_code} — {resp.text[:200]}")
        except Exception as e:
            logger.error(f"  Batch {i // batch_size + 1} error: {e}")

    return total_saved, total_skipped


def push_employees(employees, api_url, sync_key):
    """Push employee list to VPS API."""
    url = f"{api_url}/api/attendance/local-sync/employees/"
    headers = {
        'Content-Type': 'application/json',
        'X-Sync-Key': sync_key,
    }
    try:
        resp = requests.post(url, json={'employees': employees}, headers=headers, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            logger.info(f"  Employees: created={data.get('created')}, updated={data.get('updated')}")
            return True
        else:
            logger.error(f"  Employees push failed: HTTP {resp.status_code} — {resp.text[:200]}")
            return False
    except Exception as e:
        logger.error(f"  Employees push error: {e}")
        return False


def sync_once(device_ip, device_port, device_password, device_timeout,
              api_url, sync_key, sync_employees=True):
    """Thực hiện một lần sync: pull từ device → push lên VPS."""
    conn = None
    try:
        # 1. Connect to device
        conn = connect_device(device_ip, device_port, device_password, device_timeout)

        # 2. Pull attendance
        last_ts = load_state()
        records = pull_attendance(conn, last_ts)
        logger.info(f"Pulled {len(records)} new attendance records (since {last_ts.strftime('%Y-%m-%d %H:%M:%S')})")

        # 3. Push attendance to VPS
        if records:
            saved, skipped = push_attendance(records, api_url, sync_key)
            logger.info(f"Attendance sync: saved={saved}, skipped={skipped}")

            # Update state with latest record timestamp
            latest_ts_str = records[-1]['timestamp']
            latest_ts = datetime.strptime(latest_ts_str, '%Y-%m-%d %H:%M:%S')
            save_state(latest_ts)
        else:
            logger.info("No new attendance records")

        # 4. Sync employees (less frequent — every sync cycle is fine since it's fast)
        if sync_employees:
            employees = pull_employees(conn)
            if employees:
                logger.info(f"Pulled {len(employees)} employees from device")
                push_employees(employees, api_url, sync_key)

        return True

    except Exception as e:
        logger.error(f"Sync failed: {e}")
        return False

    finally:
        if conn:
            try:
                conn.disconnect()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser(description='ZKTeco Local Sync → VPS')
    parser.add_argument('--device-ip', default=DEVICE_IP, help=f'Device IP (default: {DEVICE_IP})')
    parser.add_argument('--device-port', type=int, default=DEVICE_PORT, help=f'Device port (default: {DEVICE_PORT})')
    parser.add_argument('--device-password', type=int, default=DEVICE_PASSWORD, help='Device password')
    parser.add_argument('--device-timeout', type=int, default=DEVICE_TIMEOUT, help='Connection timeout')
    parser.add_argument('--api-url', default=API_BASE_URL, help=f'VPS API URL (default: {API_BASE_URL})')
    parser.add_argument('--sync-key', default=SYNC_KEY, help='Sync API key')
    parser.add_argument('--interval', type=int, default=SYNC_INTERVAL, help=f'Sync interval seconds (default: {SYNC_INTERVAL})')
    parser.add_argument('--once', action='store_true', help='Run once and exit')
    args = parser.parse_args()

    sync_key = args.sync_key
    if not sync_key:
        logger.error("ERROR: Cần cung cấp --sync-key hoặc set SYNC_KEY environment variable")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("  ZKTeco Local Sync → VPS")
    logger.info(f"  Device:   {args.device_ip}:{args.device_port}")
    logger.info(f"  API:      {args.api_url}")
    logger.info(f"  Interval: {args.interval}s")
    logger.info("=" * 60)

    if args.once:
        success = sync_once(
            args.device_ip, args.device_port, args.device_password,
            args.device_timeout, args.api_url, sync_key,
        )
        sys.exit(0 if success else 1)

    # Loop forever
    employee_sync_counter = 0
    while True:
        try:
            # Sync employees every 10 cycles (save bandwidth)
            sync_emp = (employee_sync_counter % 10 == 0)
            employee_sync_counter += 1

            sync_once(
                args.device_ip, args.device_port, args.device_password,
                args.device_timeout, args.api_url, sync_key,
                sync_employees=sync_emp,
            )
        except KeyboardInterrupt:
            logger.info("Stopped by user")
            break
        except Exception as e:
            logger.error(f"Unexpected error: {e}")

        logger.info(f"Waiting {args.interval}s until next sync...")

        try:
            time.sleep(args.interval)
        except KeyboardInterrupt:
            logger.info("Stopped by user")
            break


if __name__ == '__main__':
    main()
