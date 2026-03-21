#!/usr/bin/env bash
set -Eeuo pipefail

BASE_DIR="${BASE_DIR:-/opt/spider-viewer}"
ACTIVE_SLOT_FILE="${ACTIVE_SLOT_FILE:-$BASE_DIR/active-slot}"
NGINX_UPSTREAM_FILE="${NGINX_UPSTREAM_FILE:-/etc/nginx/conf.d/spider-viewer-upstream.conf}"
PORT_BLUE="${PORT_BLUE:-3101}"
PORT_GREEN="${PORT_GREEN:-3102}"

if [[ ! -f "$ACTIVE_SLOT_FILE" ]]; then
	echo "Missing active slot file: $ACTIVE_SLOT_FILE" >&2
	exit 1
fi

active_slot="$(<"$ACTIVE_SLOT_FILE")"

if [[ "$active_slot" == "blue" ]]; then
	target_slot="green"
	target_port="$PORT_GREEN"
else
	target_slot="blue"
	target_port="$PORT_BLUE"
fi

target_current="$BASE_DIR/slots/$target_slot/current"

if [[ ! -L "$target_current" ]]; then
	echo "Target slot has no current release: $target_current" >&2
	exit 1
fi

sudo systemctl restart "spider-viewer@$target_slot"

for _ in {1..30}; do
	if curl -fsS "http://127.0.0.1:$target_port/readyz" >/dev/null; then
		break
	fi
	sleep 2
done

curl -fsS "http://127.0.0.1:$target_port/readyz" >/dev/null

printf 'server 127.0.0.1:%s;\n' "$target_port" | sudo tee "$NGINX_UPSTREAM_FILE" >/dev/null
sudo ln -sfn "$target_current" "$BASE_DIR/current"
echo "$target_slot" | sudo tee "$ACTIVE_SLOT_FILE" >/dev/null

sudo nginx -t
sudo systemctl reload nginx

if systemctl is-active --quiet "spider-viewer@$active_slot"; then
	sleep 5
	sudo systemctl stop "spider-viewer@$active_slot"
fi

echo "Rollback complete: active slot is now $target_slot on port $target_port"
