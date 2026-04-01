from rest_framework import serializers

from common.serializers import TimestampedModelSerializer
from communications.models import (
    CustomGroup,
    CustomGroupMember,
    Message,
    MessageAttachment,
    MessageRecipient,
    MessageTarget,
)


class MessageRecipientSerializer(TimestampedModelSerializer):
    class Meta:
        model = MessageRecipient
        fields = [
            "id",
            "message",
            "user",
            "type",
            "is_read",
            "is_important",
            "read_at",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        is_read = attrs.get("is_read", getattr(self.instance, "is_read", False))
        read_at = attrs.get("read_at", getattr(self.instance, "read_at", None))

        if is_read and read_at is None:
            raise serializers.ValidationError({"read_at": "read_at is required when is_read is true."})
        if not is_read and read_at is not None:
            raise serializers.ValidationError({"read_at": "read_at must be null when is_read is false."})
        return attrs


class MessageTargetSerializer(TimestampedModelSerializer):
    class Meta:
        model = MessageTarget
        fields = [
            "id",
            "message",
            "target_type",
            "target_id",
            "created_at",
            "updated_at",
        ]

    def validate_target_id(self, value):
        if value <= 0:
            raise serializers.ValidationError("target_id must be a positive integer.")
        return value


class MessageAttachmentSerializer(TimestampedModelSerializer):
    class Meta:
        model = MessageAttachment
        fields = [
            "id",
            "message",
            "file_url",
            "file_name",
            "file_size",
            "mime_type",
            "created_at",
            "updated_at",
        ]


class MessageSerializer(TimestampedModelSerializer):
    recipients = MessageRecipientSerializer(many=True, read_only=True)
    targets = MessageTargetSerializer(many=True, read_only=True)
    attachments = MessageAttachmentSerializer(many=True, read_only=True)
    replies = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Message
        fields = [
            "id",
            "subject",
            "content",
            "sender",
            "is_important",
            "related_request",
            "parent",
            "recipients",
            "targets",
            "attachments",
            "replies",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["sender"]

    def validate(self, attrs):
        parent = attrs.get("parent")
        instance = getattr(self, "instance", None)

        if instance and parent and instance.pk == parent.pk:
            raise serializers.ValidationError({"parent": "Message cannot reply to itself."})
        return attrs

    def get_replies(self, obj):
        return MessageSerializer(obj.replies.all(), many=True, context=self.context).data


class CustomGroupMemberSerializer(TimestampedModelSerializer):
    class Meta:
        model = CustomGroupMember
        fields = [
            "id",
            "group",
            "user",
            "created_at",
            "updated_at",
        ]


class CustomGroupSerializer(TimestampedModelSerializer):
    members = CustomGroupMemberSerializer(many=True, read_only=True)

    class Meta:
        model = CustomGroup
        fields = [
            "id",
            "name",
            "created_by",
            "members",
            "created_at",
            "updated_at",
        ]


class CustomGroupLookupSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomGroup
        fields = [
            "id",
            "name",
        ]
