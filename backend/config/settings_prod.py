"""
Production settings overlay.
Import everything from base settings, then override for production.

Usage: DJANGO_SETTINGS_MODULE=config.settings_prod
"""
from .settings import *  # noqa: F401,F403
import os


# ── Security ──
DEBUG = False
SECRET_KEY = os.environ['SECRET_KEY']
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '').split(',') + ['localhost', '127.0.0.1']

# ── Database: PostgreSQL ──
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('DB_NAME', 'erp'),
        'USER': os.environ.get('DB_USER', 'erp'),
        'PASSWORD': os.environ.get('DB_PASSWORD', ''),
        'HOST': os.environ.get('DB_HOST', 'db'),
        'PORT': os.environ.get('DB_PORT', '5432'),
        'CONN_MAX_AGE': 600,
    }
}
# Allow DATABASE_URL override (docker-compose sets this)
_db_url = os.environ.get('DATABASE_URL')
if _db_url:
    import re
    m = re.match(r'postgres://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)', _db_url)
    if m:
        DATABASES['default'].update({
            'USER': m.group(1),
            'PASSWORD': m.group(2),
            'HOST': m.group(3),
            'PORT': m.group(4),
            'NAME': m.group(5),
        })

# ── Redis Channel Layers (thay InMemoryChannelLayer) ──
_redis_url = os.environ.get('REDIS_URL', 'redis://redis:6379/0')
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [_redis_url],
        },
    }
}

# ── Celery ──
CELERY_BROKER_URL = _redis_url
CELERY_RESULT_BACKEND = 'django-db'

# ── CORS ──
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',')
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = True

# ── Static / Media ──
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# ── Security Middleware ──
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'SAMEORIGIN'

# ── Logging ──
LOGGING['loggers']['attendance']['level'] = 'INFO'
LOGGING['loggers']['django.server']['level'] = 'WARNING'
