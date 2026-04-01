#!/bin/bash
# ============================================================
# Script chuyển dữ liệu SQLite → PostgreSQL
# Chạy trên VPS sau khi docker compose up
# ============================================================
set -e

cd /opt/erp

echo "============================================"
echo "  CHUYỂN DỮ LIỆU SQLite → PostgreSQL"
echo "============================================"
echo ""

# Bước 1: Kiểm tra file db.sqlite3 tồn tại
if [ ! -f "backend/db.sqlite3" ]; then
    echo "❌ Không tìm thấy backend/db.sqlite3"
    echo "   Hãy copy file db.sqlite3 từ máy local lên VPS trước:"
    echo "   scp d:\\myproject\\ERP (COPY)\\backend\\db.sqlite3 root@VPS_IP:/opt/erp/backend/"
    exit 1
fi

echo "✅ Tìm thấy db.sqlite3 ($(du -h backend/db.sqlite3 | cut -f1))"
echo ""

# Bước 2: Đảm bảo PostgreSQL đang chạy + đã migrate schema
echo "→ Bước 1/4: Đảm bảo containers đang chạy..."
docker compose up -d db redis
sleep 5

echo "→ Bước 2/4: Chạy migrations để tạo schema trong PostgreSQL..."
docker compose run --rm backend python manage.py migrate --noinput
echo "✅ Schema PostgreSQL đã sẵn sàng"
echo ""

# Bước 3: Export dữ liệu từ SQLite
echo "→ Bước 3/4: Export dữ liệu từ SQLite..."

# Tạo settings tạm dùng SQLite để export
cat > /opt/erp/backend/config/settings_sqlite_export.py << 'PYEOF'
from config.settings import *
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}
PYEOF

docker compose run --rm \
    -e DJANGO_SETTINGS_MODULE=config.settings_sqlite_export \
    backend python manage.py dumpdata \
    --natural-foreign \
    --natural-primary \
    --exclude=contenttypes \
    --exclude=auth.permission \
    --exclude=sessions.session \
    --exclude=admin.logentry \
    --indent=2 \
    --output=/app/data_dump.json

# Xóa settings tạm
rm -f /opt/erp/backend/config/settings_sqlite_export.py

echo "✅ Dữ liệu đã export thành data_dump.json"
echo ""

# Bước 4: Import vào PostgreSQL (chạy với settings_prod, dùng PostgreSQL)
echo "→ Bước 4/4: Import dữ liệu vào PostgreSQL..."
docker compose run --rm backend python -c "
import os, sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings_prod')

import django
django.setup()

from django.core.management import call_command

print('Đang import vào PostgreSQL...', file=sys.stderr)
try:
    call_command('loaddata', '/app/data_dump.json', verbosity=1)
    print('✅ Import thành công!', file=sys.stderr)
except Exception as e:
    print(f'⚠️  Lỗi loaddata: {e}', file=sys.stderr)
    print('Thử lại với --ignorenonexistent...', file=sys.stderr)
    call_command('loaddata', '/app/data_dump.json', ignorenonexistent=True, verbosity=1)
    print('✅ Import thành công (bỏ qua fields không tồn tại)!', file=sys.stderr)
"

echo ""
echo "============================================"
echo "  ✅ HOÀN TẤT!"
echo "============================================"
echo ""
echo "Kiểm tra dữ liệu:"
echo "  docker compose exec backend python manage.py shell -c \\"
echo "    'from users.models import User; print(f\"Users: {User.objects.count()}\")'"
echo ""
echo "Nếu OK, khởi động toàn bộ hệ thống:"
echo "  docker compose up -d"
echo ""
