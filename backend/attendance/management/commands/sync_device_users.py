"""
Sync Device Users — Django Management Command
==============================================

Connects to attendance machine via pyzk (ZK binary protocol) through
MikroTik NAT and pulls the user list (uid, user_id, name, privilege, card).

Saves/updates Employee records in database and links existing
AttendanceLog records to the matched Employee.

Architecture:
    VPS (123.30.48.72) ──TCP:4370──► Router NAT (113.160.150.125:4370)
                                              │
                                       Port forward
                                              │
                                    Device LAN (192.168.1.225:4370)

Prerequisites:
    1. MikroTik NAT rule: dst-port=4370 → 192.168.1.225:4370
    2. MikroTik filter rule: forward accept tcp dst-port=4370
    3. VPS firewall: ufw allow 4370/tcp (only needed if testing nc from outside)

Usage:
    # Pull users from device via WAN IP
    python manage.py sync_device_users

    # Specify custom IP/port
    python manage.py sync_device_users --ip 113.160.150.125 --port 4370

    # Dry run (show users without saving)
    python manage.py sync_device_users --dry-run

    # Use LAN IP (if VPS is on same network)
    python manage.py sync_device_users --ip 192.168.1.225
"""
import logging

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

logger = logging.getLogger('attendance.sync_users')


class Command(BaseCommand):
    help = 'Sync user list from attendance machine via pyzk'

    def add_arguments(self, parser):
        parser.add_argument(
            '--ip', type=str,
            default=None,
            help='Device IP (default: ZK_DEVICE_IP from settings or 113.160.150.125)',
        )
        parser.add_argument(
            '--port', type=int,
            default=4370,
            help='Device ZK binary port (default: 4370)',
        )
        parser.add_argument(
            '--timeout', type=int,
            default=10,
            help='Connection timeout in seconds (default: 10)',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Show users without saving to database',
        )

    def handle(self, *args, **options):
        ip = options['ip'] or getattr(settings, 'ZK_DEVICE_IP', '113.160.150.125')
        port = options['port']
        timeout = options['timeout']
        dry_run = options['dry_run']

        self.stdout.write(f"\n[SYNC] Connecting to {ip}:{port} (timeout={timeout}s)...")

        try:
            from zk import ZK
        except ImportError:
            self.stderr.write("ERROR: pyzk not installed. Add 'pyzk' to requirements.txt")
            return

        # Try multiple connection profiles (same as ZKBinaryService)
        profiles = [
            {'force_udp': False, 'ommit_ping': True},   # TCP, skip ping (most likely to work via NAT)
            {'force_udp': False, 'ommit_ping': False},   # TCP, with ping
            {'force_udp': True,  'ommit_ping': True},    # UDP, skip ping
        ]

        conn = None
        for i, profile in enumerate(profiles):
            try:
                self.stdout.write(f"  Profile {i+1}/{len(profiles)}: {profile}")
                zk = ZK(ip, port=port, timeout=timeout, password=0, **profile)
                conn = zk.connect()
                self.stdout.write(self.style.SUCCESS(f"  ✓ Connected! (profile {i+1})"))
                break
            except Exception as e:
                self.stdout.write(f"  ✗ Failed: {e}")
                conn = None

        if not conn:
            self.stderr.write(self.style.ERROR(
                f"\n[SYNC] Could not connect to device at {ip}:{port}\n"
                "  Possible causes:\n"
                "  1. MikroTik NAT rule missing for port 4370\n"
                "  2. MikroTik filter rule not allowing port 4370 forward\n"
                "  3. Device powered off or not reachable\n"
                "  4. Wrong IP address\n"
                "\n  See: deploy/sync-device-users-guide.txt"
            ))
            return

        try:
            # Disable device temporarily (prevents punch during sync)
            conn.disable_device()
            self.stdout.write("[SYNC] Device disabled temporarily for data read...")

            # Pull users
            users = conn.get_users()
            self.stdout.write(f"[SYNC] Found {len(users)} users on device\n")

            if not users:
                self.stdout.write(self.style.WARNING("[SYNC] No users found on device!"))
                conn.enable_device()
                return

            # Display users
            self.stdout.write(f"  {'UID':<6} {'UserID':<10} {'Name':<30} {'Priv':<6} {'Card':<10}")
            self.stdout.write(f"  {'─'*6} {'─'*10} {'─'*30} {'─'*6} {'─'*10}")
            for u in users:
                self.stdout.write(
                    f"  {u.uid:<6} {str(u.user_id):<10} {(u.name or ''):<30} "
                    f"{u.privilege:<6} {u.card or 0:<10}"
                )

            if dry_run:
                self.stdout.write(self.style.WARNING(
                    f"\n[SYNC] Dry run — {len(users)} users found, not saved."
                ))
                conn.enable_device()
                return

            # Save to database
            from attendance.models import Employee, AttendanceLog

            created = 0
            updated = 0
            for u in users:
                user_id = str(u.user_id)
                name = u.name or f"User {user_id}"

                obj, is_new = Employee.objects.update_or_create(
                    uid=u.uid,
                    defaults={
                        'user_id': user_id,
                        'name': name,
                        'privilege': u.privilege,
                        'group_id': str(u.group_id or ''),
                        'card': u.card or 0,
                    }
                )

                # Link orphan AttendanceLogs to this employee
                linked = AttendanceLog.objects.filter(
                    user_id=user_id, employee__isnull=True
                ).update(employee=obj)

                if is_new:
                    created += 1
                    if linked:
                        logger.info(f"[SYNC] Created employee {user_id} ({name}), linked {linked} logs")
                else:
                    updated += 1

            conn.enable_device()

            self.stdout.write(self.style.SUCCESS(
                f"\n[SYNC] Done! {created} created, {updated} updated, "
                f"{len(users)} total employees synced."
            ))

        except Exception as e:
            self.stderr.write(self.style.ERROR(f"\n[SYNC] Error: {e}"))
            logger.error(f"[SYNC] sync_device_users error: {e}", exc_info=True)
        finally:
            try:
                conn.disconnect()
            except Exception:
                pass
            self.stdout.write("[SYNC] Disconnected from device.")
