#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

cd "$APP_DIR"

if [[ ! -f "$COMPOSE_FILE" ]]; then
	echo "Compose file not found: $COMPOSE_FILE" >&2
	exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Environment file not found: $ENV_FILE" >&2
	exit 1
fi

compose_cmd=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

"${compose_cmd[@]}" up -d postgres redis
"${compose_cmd[@]}" build app
"${compose_cmd[@]}" run --rm app bun run db:push
"${compose_cmd[@]}" up -d app
"${compose_cmd[@]}" ps
