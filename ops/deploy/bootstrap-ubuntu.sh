#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="${APP_USER:-spider}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
BASE_DIR="${BASE_DIR:-/opt/spider-viewer}"
SYSTEMD_UNIT_PATH="${SYSTEMD_UNIT_PATH:-/etc/systemd/system/spider-viewer@.service}"
NGINX_SITE_PATH="${NGINX_SITE_PATH:-/etc/nginx/sites-available/spider-viewer.conf}"
NGINX_SITE_LINK="${NGINX_SITE_LINK:-/etc/nginx/sites-enabled/spider-viewer.conf}"
NGINX_UPSTREAM_FILE="${NGINX_UPSTREAM_FILE:-/etc/nginx/spider-viewer-upstream.conf}"
ENV_DIR="${ENV_DIR:-/etc/spider-viewer}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

sudo apt-get update
sudo apt-get install -y nginx curl rsync

if ! id -u "$APP_USER" >/dev/null 2>&1; then
	sudo useradd --system --create-home --shell /bin/bash "$APP_USER"
fi

sudo mkdir -p "$BASE_DIR/slots/blue" "$BASE_DIR/slots/green" "$ENV_DIR/slots"
sudo chown -R "$APP_USER:$APP_GROUP" "$BASE_DIR"

sudo install -m 0644 "$PROJECT_ROOT/ops/systemd/spider-viewer@.service" "$SYSTEMD_UNIT_PATH"
sudo install -m 0644 "$PROJECT_ROOT/ops/nginx/spider-viewer.conf" "$NGINX_SITE_PATH"
sudo ln -sfn "$NGINX_SITE_PATH" "$NGINX_SITE_LINK"

if [[ ! -f "$ENV_DIR/spider-viewer.env" ]]; then
	sudo install -m 0640 "$PROJECT_ROOT/ops/deploy/spider-viewer.env.example" "$ENV_DIR/spider-viewer.env"
fi

if [[ ! -f "$ENV_DIR/slots/blue.env" ]]; then
	printf 'PORT=3101\nRELEASE_ID=bootstrap-blue\n' | sudo tee "$ENV_DIR/slots/blue.env" >/dev/null
fi

if [[ ! -f "$ENV_DIR/slots/green.env" ]]; then
	printf 'PORT=3102\nRELEASE_ID=bootstrap-green\n' | sudo tee "$ENV_DIR/slots/green.env" >/dev/null
fi

printf 'server 127.0.0.1:3101;\n' | sudo tee "$NGINX_UPSTREAM_FILE" >/dev/null
sudo rm -f /etc/nginx/conf.d/spider-viewer-upstream.conf

sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable nginx

echo "Bootstrap complete. Fill $ENV_DIR/spider-viewer.env, then run ops/deploy/deploy-blue-green.sh"
