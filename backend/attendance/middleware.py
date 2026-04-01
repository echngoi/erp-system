"""
Middleware ghi log MỌI HTTP request.
Dùng để debug kết nối từ máy chấm công.
"""
import logging

logger = logging.getLogger('attendance.middleware')


class RequestLoggingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Log mọi request TRƯỚC khi xử lý
        client_ip = request.META.get('REMOTE_ADDR', '?')
        method = request.method
        path = request.get_full_path()
        content_type = request.META.get('CONTENT_TYPE', '')
        body_preview = ''
        if method == 'POST':
            try:
                body_preview = request.body[:300].decode('utf-8', errors='replace')
            except Exception:
                body_preview = '<binary>'

        logger.warning(
            f"[REQ] {client_ip} {method} {path} "
            f"CT={content_type} body={body_preview[:200]}"
        )

        response = self.get_response(request)

        logger.warning(
            f"[RES] {client_ip} {method} {path} → {response.status_code}"
        )
        return response
