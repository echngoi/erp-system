from notifications.models import Notification


def create_notifications(user_ids, content, notification_type, exclude_user_id=None):
    unique_user_ids = {int(user_id) for user_id in user_ids if user_id is not None}
    if exclude_user_id is not None:
        unique_user_ids.discard(int(exclude_user_id))

    if not unique_user_ids:
        return 0

    rows = [
        Notification(
            user_id=user_id,
            content=content,
            type=notification_type,
        )
        for user_id in unique_user_ids
    ]
    Notification.objects.bulk_create(rows)
    return len(rows)
