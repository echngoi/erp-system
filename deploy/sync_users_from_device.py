"""
Sync user list from Ronald Jack AI06F attendance machine to ERP server.
=========================================================================

Run this script FROM YOUR PC (same LAN as the device):
    pip install pyzk
    python deploy/sync_users_from_device.py

The script:
  1. Connects to the device via pyzk (UDP port 4370)
  2. Pulls user list (uid, user_id, name)
  3. Uploads to ERP backend API

Requirements:
  - PC and device on same LAN
  - Device IP reachable (default: 192.168.1.225)
  - ERP backend running (default: https://api.hrmgo.site)
"""
import argparse
import json
import sys

try:
    from zk import ZK
except ImportError:
    print("ERROR: pyzk not installed. Run: pip install pyzk")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)


def get_users_from_device(device_ip, device_port=4370):
    """Connect to device via pyzk and pull user list."""
    print(f"\n[1/3] Connecting to device at {device_ip}:{device_port}...")
    zk = ZK(device_ip, port=device_port, timeout=10)
    conn = zk.connect()
    print(f"  ✓ Connected!")

    try:
        users = conn.get_users()
        print(f"  ✓ Found {len(users)} users on device")

        user_list = []
        for u in users:
            user_list.append({
                'uid': u.uid,
                'user_id': str(u.user_id),
                'name': u.name or f"User {u.user_id}",
                'privilege': u.privilege,
                'group_id': str(u.group_id or ''),
                'card': u.card or 0,
            })
            print(f"    - UID={u.uid} ID={u.user_id} Name={u.name} "
                  f"Priv={u.privilege} Card={u.card}")

        return user_list
    finally:
        conn.disconnect()
        print(f"  ✓ Disconnected from device")


def upload_to_server(users, api_base, username, password):
    """Upload user list to ERP backend."""
    print(f"\n[2/3] Logging in to {api_base}...")

    # Login to get token
    login_url = f"{api_base}/api/auth/login/"
    login_resp = requests.post(login_url, json={
        'username': username,
        'password': password,
    }, timeout=15)

    if login_resp.status_code != 200:
        print(f"  ✗ Login failed: {login_resp.status_code} {login_resp.text}")
        return False

    token = login_resp.json().get('access') or login_resp.json().get('token')
    if not token:
        # Try other response formats
        data = login_resp.json()
        token = data.get('access_token') or data.get('key')

    if not token:
        print(f"  ✗ Could not extract token from login response: {login_resp.json()}")
        return False

    print(f"  ✓ Logged in!")

    # Upload users via batch endpoint
    print(f"\n[3/3] Uploading {len(users)} users to server...")
    headers = {'Authorization': f'Bearer {token}'}
    upload_url = f"{api_base}/api/attendance/employees/batch-create/"
    resp = requests.post(upload_url, json={'users': users},
                         headers=headers, timeout=30)

    if resp.status_code in (200, 201):
        result = resp.json()
        print(f"  ✓ Upload result: {json.dumps(result, ensure_ascii=False)}")
        return True
    else:
        print(f"  ✗ Upload failed: {resp.status_code}")
        print(f"    Response: {resp.text[:500]}")

        # Fallback: try sync-users endpoint with direct data
        print(f"\n  Trying fallback: creating employees one by one...")
        created = 0
        updated = 0
        for u in users:
            emp_url = f"{api_base}/api/attendance/employees/create-from-device/"
            r = requests.post(emp_url, json=u, headers=headers, timeout=10)
            if r.status_code in (200, 201):
                if r.json().get('created'):
                    created += 1
                else:
                    updated += 1
            else:
                print(f"    ✗ Error for user {u['user_id']}: {r.status_code}")

        print(f"\n  ✓ Done: {created} created, {updated} updated")
        return True


def save_to_file(users, output_file='device_users.json'):
    """Save user list to JSON file (backup / offline import)."""
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)
    print(f"\n  ✓ User list saved to {output_file}")


def main():
    parser = argparse.ArgumentParser(
        description='Sync users from attendance device to ERP server')
    parser.add_argument('--device-ip', default='192.168.1.225',
                        help='Device IP (default: 192.168.1.225)')
    parser.add_argument('--device-port', type=int, default=4370,
                        help='Device port (default: 4370)')
    parser.add_argument('--api', default='https://api.hrmgo.site',
                        help='ERP API base URL')
    parser.add_argument('--username', default='admin',
                        help='ERP admin username')
    parser.add_argument('--password', default='',
                        help='ERP admin password')
    parser.add_argument('--save-only', action='store_true',
                        help='Only save to JSON file, do not upload')
    args = parser.parse_args()

    # Step 1: Get users from device
    try:
        users = get_users_from_device(args.device_ip, args.device_port)
    except Exception as e:
        print(f"\n  ✗ Failed to connect to device: {e}")
        print(f"    Make sure you are on the same LAN as the device")
        print(f"    and the device IP ({args.device_ip}) is correct.")
        sys.exit(1)

    if not users:
        print("\n  No users found on device!")
        sys.exit(0)

    # Always save to file as backup
    save_to_file(users)

    if args.save_only:
        print("\n  --save-only mode: skipping upload")
        return

    # Step 2+3: Upload to server
    if not args.password:
        print("\n  ⚠ No --password provided. Skipping upload to server.")
        print(f"  To upload, run again with: --password YOUR_ADMIN_PASSWORD")
        print(f"  Or import manually from device_users.json")
        return

    upload_to_server(users, args.api, args.username, args.password)

    print("\n" + "=" * 60)
    print("DONE! Check the ERP dashboard for employee names.")
    print("=" * 60)


if __name__ == '__main__':
    main()
