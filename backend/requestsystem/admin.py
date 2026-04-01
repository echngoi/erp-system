from django.contrib import admin

from requestsystem.models import RequestQuickTitle


@admin.register(RequestQuickTitle)
class RequestQuickTitleAdmin(admin.ModelAdmin):
    list_display = ["title", "is_active", "sort_order", "created_at"]
    list_editable = ["is_active", "sort_order"]
    search_fields = ["title"]
    ordering = ["sort_order", "title"]
