#!/bin/bash
set -e

echo "→ Waiting for database..."
while ! python -c "
import django, os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings_prod')
django.setup()
from django.db import connection
connection.ensure_connection()
" 2>/dev/null; do
    echo "  DB not ready, retrying in 2s..."
    sleep 2
done

echo "→ Running migrations..."
python manage.py migrate --noinput

echo "→ Collecting static files..."
python manage.py collectstatic --noinput

echo "→ Starting ZK Push TCP Server (port 5005)..."
python manage.py run_zk_push --port 5005 &
ZK_PID=$!
echo "  ZK Push TCP Server started (PID=$ZK_PID)"

echo "→ Starting Daphne..."
exec daphne -b 0.0.0.0 -p 8000 config.asgi:application
