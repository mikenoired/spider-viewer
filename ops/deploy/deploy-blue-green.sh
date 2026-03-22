#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-spider-viewer}"
APP_USER="${APP_USER:-spider}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
BASE_DIR="${BASE_DIR:-/opt/spider-viewer}"
ENV_DIR="${ENV_DIR:-/etc/spider-viewer}"
NGINX_UPSTREAM_FILE="${NGINX_UPSTREAM_FILE:-/etc/nginx/spider-viewer-upstream.conf}"
ACTIVE_SLOT_FILE="${ACTIVE_SLOT_FILE:-$BASE_DIR/active-slot}"
PORT_BLUE="${PORT_BLUE:-3101}"
PORT_GREEN="${PORT_GREEN:-3102}"
SOURCE_DIR="${SOURCE_DIR:-$(pwd)}"

if [[ ! -f "$ENV_DIR/spider-viewer.env" ]]; then
	echo "Missing shared env file: $ENV_DIR/spider-viewer.env" >&2
	exit 1
fi

active_slot="blue"
if [[ -f "$ACTIVE_SLOT_FILE" ]]; then
	active_slot="$(<"$ACTIVE_SLOT_FILE")"
fi

if [[ "$active_slot" == "blue" ]]; then
	inactive_slot="green"
	inactive_port="$PORT_GREEN"
	active_port="$PORT_BLUE"
else
	inactive_slot="blue"
	inactive_port="$PORT_BLUE"
	active_port="$PORT_GREEN"
fi

slot_dir="$BASE_DIR/slots/$inactive_slot"
release_id="$(date +%Y%m%d%H%M%S)"
release_dir="$slot_dir/releases/$release_id"
current_link="$slot_dir/current"
shared_env_file="$ENV_DIR/spider-viewer.env"
slot_env_file="$ENV_DIR/slots/$inactive_slot.env"

sudo mkdir -p "$slot_dir/releases" "$ENV_DIR/slots"
sudo chown -R "$APP_USER:$APP_GROUP" "$BASE_DIR"

sudo -u "$APP_USER" mkdir -p "$release_dir"
sudo -u "$APP_USER" rsync -a --delete \
	--exclude ".git" \
	--exclude "node_modules" \
	--exclude "dist" \
	--exclude ".env" \
	"$SOURCE_DIR/" "$release_dir/"

cat <<EOF | sudo tee "$slot_env_file" >/dev/null
PORT=$inactive_port
RELEASE_ID=$release_id
EOF

sudo -u "$APP_USER" bash -lc "set -a && source '$shared_env_file' && set +a && cd '$release_dir' && bun install --frozen-lockfile && bun run build && bun run db:migrate"
sudo ln -sfn "$release_dir" "$current_link"
sudo systemctl enable "spider-viewer@$inactive_slot" >/dev/null
sudo systemctl restart "spider-viewer@$inactive_slot"

for _ in {1..30}; do
	if curl -fsS "http://127.0.0.1:$inactive_port/readyz" >/dev/null; then
		break
	fi
	sleep 2
done

curl -fsS "http://127.0.0.1:$inactive_port/readyz" >/dev/null

printf 'server 127.0.0.1:%s;\n' "$inactive_port" | sudo tee "$NGINX_UPSTREAM_FILE" >/dev/null
sudo rm -f /etc/nginx/conf.d/spider-viewer-upstream.conf
sudo ln -sfn "$current_link" "$BASE_DIR/current"
echo "$inactive_slot" | sudo tee "$ACTIVE_SLOT_FILE" >/dev/null

sudo nginx -t
sudo systemctl reload nginx

if systemctl is-active --quiet "spider-viewer@$active_slot"; then
	sleep 5
	sudo systemctl stop "spider-viewer@$active_slot"
fi

echo "Deploy complete: $inactive_slot on port $inactive_port (release $release_id)"
echo "Previous active slot: $active_slot on port $active_port"
