"""
Data migration: Remove duplicate AttendanceLog records.

The device replayed cached punch notifications every ~10s on WAN,
creating hundreds of duplicates for the same user_id. This migration
keeps only the earliest record per (user_id, date, minute) and deletes
the rest.
"""
from django.db import migrations


def remove_duplicates(apps, schema_editor):
    AttendanceLog = apps.get_model('attendance', 'AttendanceLog')
    total = AttendanceLog.objects.count()

    # Find duplicate groups: same user_id records within 60 seconds
    # Strategy: for each user_id, keep only the first record per minute
    from django.db.models import Min, Count
    from django.db.models.functions import TruncMinute

    # Group by (user_id, truncated-to-minute timestamp)
    dupes = (
        AttendanceLog.objects
        .annotate(ts_minute=TruncMinute('timestamp'))
        .values('user_id', 'ts_minute')
        .annotate(cnt=Count('id'), min_id=Min('id'))
        .filter(cnt__gt=1)
    )

    ids_to_delete = []
    for group in dupes:
        # Get all IDs in this group except the earliest
        group_ids = list(
            AttendanceLog.objects
            .annotate(ts_minute=TruncMinute('timestamp'))
            .filter(user_id=group['user_id'], ts_minute=group['ts_minute'])
            .exclude(id=group['min_id'])
            .values_list('id', flat=True)
        )
        ids_to_delete.extend(group_ids)

    if ids_to_delete:
        # Delete in batches to avoid memory issues
        batch_size = 500
        deleted = 0
        for i in range(0, len(ids_to_delete), batch_size):
            batch = ids_to_delete[i:i + batch_size]
            count, _ = AttendanceLog.objects.filter(id__in=batch).delete()
            deleted += count
        print(f"\n  Deleted {deleted} duplicate AttendanceLog records "
              f"(from {total} total, kept {total - deleted})")
    else:
        print(f"\n  No duplicate records found ({total} total)")


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('attendance', '0006_late_early_rules_and_penalties'),
    ]

    operations = [
        migrations.RunPython(remove_duplicates, noop),
    ]
