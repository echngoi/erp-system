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
    echo "   scp db.sqlite3 root@VPS_IP:/opt/erp/backend/"
    exit 1
fi

echo "✅ Tìm thấy db.sqlite3 ($(du -h backend/db.sqlite3 | cut -f1))"
echo ""

# Bước 2: Đảm bảo PostgreSQL đang chạy + đã migrate schema
echo "→ Bước 1/4: Đảm bảo containers đang chạy..."
docker compose up -d db redis
sleep 8

echo "→ Bước 2/4: Chạy migrations để tạo schema trong PostgreSQL..."
docker compose run --rm backend python manage.py migrate --noinput
echo "✅ Schema PostgreSQL đã sẵn sàng"
echo ""

# Bước 3: Export dữ liệu từ SQLite ra HOST filesystem (không dùng --rm để giữ file)
echo "→ Bước 3/4: Export dữ liệu từ SQLite ra /opt/erp/data_dump.json ..."

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

# Export ra /opt/erp/ trên HOST (mount -v để file tồn tại sau khi container xóa)
docker run --rm \
    -v /opt/erp/backend:/app \
    -e DJANGO_SETTINGS_MODULE=config.settings_sqlite_export \
    erp-backend \
    python manage.py dumpdata \
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

# Kiểm tra file dump
if [ ! -f "backend/data_dump.json" ]; then
    echo "❌ Export thất bại - file data_dump.json không tồn tại"
    exit 1
fi

DUMP_SIZE=$(du -h backend/data_dump.json | cut -f1)
echo "✅ Dữ liệu đã export: /opt/erp/backend/data_dump.json ($DUMP_SIZE)"
echo ""

# Bước 4: Import vào PostgreSQL - mount file từ HOST vào container
echo "→ Bước 4/4: Import dữ liệu vào PostgreSQL..."
docker run --rm \
    -v /opt/erp/backend:/app \
    --network erp_default \
    -e DJANGO_SETTINGS_MODULE=config.settings_prod \
    --env-file /opt/erp/backend/.env.production \
    erp-backend \
    python manage.py loaddata /app/data_dump.json --ignorenonexistent

echo ""
echo "============================================"
echo "  ✅ HOÀN TẤT!"
echo "============================================"
echo ""
echo "Kiểm tra dữ liệu:"
echo "  docker compose exec backend python manage.py shell -c \\"
echo "    'from users.models import User; from attendance.models import Employee; print(f\"Users: {User.objects.count()}, Employees: {Employee.objects.count()}\")'"
echo ""
echo "Khởi động toàn bộ hệ thống:"
echo "  docker compose up -d"
echo ""
