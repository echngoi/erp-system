#!/bin/bash
# ══════════════════════════════════════════════════════════
# ERP First-time VPS Setup Script
# Run on a fresh Hetzner VPS (Ubuntu 22.04 / 24.04)
# Usage: bash setup-vps.sh YOUR_DOMAIN.com YOUR_EMAIL
# ══════════════════════════════════════════════════════════
set -euo pipefail

DOMAIN="${1:?Usage: bash setup-vps.sh YOUR_DOMAIN.com YOUR_EMAIL}"
EMAIL="${2:?Usage: bash setup-vps.sh YOUR_DOMAIN.com YOUR_EMAIL}"

echo "══════════════════════════════════════════"
echo "  ERP VPS Setup — Domain: $DOMAIN"
echo "══════════════════════════════════════════"

# ── 1. System update ──
echo "→ Updating system..."
apt-get update && apt-get upgrade -y

# ── 2. Install Docker ──
echo "→ Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# ── 3. Install Docker Compose plugin ──
echo "→ Docker Compose version:"
docker compose version

# ── 4. Install Git ──
apt-get install -y git

# ── 5. Setup firewall ──
echo "→ Configuring firewall..."
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (máy chấm công + ACME)
ufw allow 443/tcp   # HTTPS (web app)
echo "y" | ufw enable

# ── 6. Clone repository ──
echo "→ Cloning repository..."
if [ ! -d /opt/erp ]; then
    echo "PASTE YOUR GITHUB REPO URL below:"
    echo "  git clone https://github.com/YOUR_USER/YOUR_REPO.git /opt/erp"
    echo ""
    echo "After cloning, re-run this script."
    echo "Or clone manually and continue:"
    read -p "GitHub repo URL: " REPO_URL
    git clone "$REPO_URL" /opt/erp
fi
cd /opt/erp

# ── 7. Create production .env ──
echo "→ Creating production .env..."
if [ ! -f backend/.env.production ]; then
    SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))" 2>/dev/null || openssl rand -base64 50)
    DB_PASS=$(openssl rand -base64 24 | tr -d '=/+')

    cat > backend/.env.production << EOF
DEBUG=False
SECRET_KEY=${SECRET}
ALLOWED_HOSTS=${DOMAIN},www.${DOMAIN}
CORS_ALLOWED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}
DJANGO_SETTINGS_MODULE=config.settings_prod

ZK_DEVICE_IP=0.0.0.0
ZK_DEVICE_PORT=5005
ZK_DEVICE_TIMEOUT=10
ZK_DEVICE_PASSWORD=0
ZK_PROTOCOL=adms

DB_NAME=erp
DB_USER=erp
DB_PASSWORD=${DB_PASS}
EOF

    # .env for docker-compose
    cat > .env << EOF
DB_NAME=erp
DB_USER=erp
DB_PASSWORD=${DB_PASS}
EOF

    echo "✅ .env files created"
    echo "   DB Password: ${DB_PASS}"
    echo "   (Save this somewhere safe!)"
fi

# ── 8. Replace domain in nginx config ──
echo "→ Configuring Nginx for $DOMAIN..."
sed -i "s/YOUR_DOMAIN.com/$DOMAIN/g" deploy/nginx.conf

# ── 9. Get SSL certificate (initial — HTTP only first) ──
echo "→ Getting SSL certificate..."

# Create temporary nginx for ACME challenge
mkdir -p deploy/nginx-temp
cat > deploy/nginx-temp/default.conf << 'NGINX'
server {
    listen 80;
    server_name _;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 200 'OK';
    }
}
NGINX

# Start temporary nginx
docker compose up -d nginx
sleep 3

# Get certificate
docker compose run --rm certbot certonly \
    --webroot --webroot-path=/var/www/certbot \
    --email "$EMAIL" --agree-tos --no-eff-email \
    -d "$DOMAIN"

# Remove temp config
rm -rf deploy/nginx-temp

# ── 10. Build and start all services ──
echo "→ Building and starting services..."
docker compose build
docker compose up -d

# ── 11. Run initial migrations ──
echo "→ Running migrations..."
sleep 10  # Wait for DB to be ready
docker compose exec -T backend python manage.py migrate --noinput
docker compose exec -T backend python manage.py collectstatic --noinput

# ── 12. Create superuser ──
echo "→ Creating admin user..."
docker compose exec -T backend python manage.py createsuperuser --noinput \
    --username admin --email "$EMAIL" 2>/dev/null || echo "(Admin user may already exist)"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  ✅ DEPLOYMENT COMPLETE!"
echo "══════════════════════════════════════════════════════"
echo ""
echo "  Backend:  https://$DOMAIN/api/"
echo "  Admin:    https://$DOMAIN/admin/"
echo "  iclock:   http://$DOMAIN/iclock/cdata"
echo ""
echo "  Next steps:"
echo "  1. Deploy frontend to Vercel (see below)"
echo "  2. Add Vercel domain to CORS_ALLOWED_ORIGINS in"
echo "     backend/.env.production"
echo "  3. Configure máy chấm công:"
echo "     - Sử dụng tên miền: Có"
echo "     - Tên miền: $DOMAIN"
echo "     - Số cổng: 80"
echo "══════════════════════════════════════════════════════"
