#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

DATABASE_URL="${DATABASE_URL:-}"
DB_BACKUP_DIR="${DB_BACKUP_DIR:-/opt/spider-viewer/backups/postgres}"
DB_BACKUP_RETENTION_DAYS="${DB_BACKUP_RETENTION_DAYS:-7}"
BACKUP_PREFIX="spider-viewer-postgres"

if [[ -z "$DATABASE_URL" ]]; then
	echo "DATABASE_URL is required for database backups." >&2
	exit 1
fi

if ! [[ "$DB_BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( DB_BACKUP_RETENTION_DAYS < 1 )); then
	echo "DB_BACKUP_RETENTION_DAYS must be an integer greater than 0." >&2
	exit 1
fi

mkdir -p "$DB_BACKUP_DIR"

lock_file="$DB_BACKUP_DIR/.backup.lock"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$DB_BACKUP_DIR/${BACKUP_PREFIX}-${timestamp}.dump"
tmp_file="${backup_file}.tmp"
prune_mtime="$((DB_BACKUP_RETENTION_DAYS - 1))"

exec 9>"$lock_file"
if ! flock -n 9; then
	echo "Database backup is already running, skipping." >&2
	exit 0
fi

cleanup() {
	rm -f "$tmp_file"
}

trap cleanup EXIT

pg_dump \
	--dbname="$DATABASE_URL" \
	--format=custom \
	--compress=9 \
	--no-owner \
	--no-privileges \
	--file="$tmp_file"

mv "$tmp_file" "$backup_file"

find "$DB_BACKUP_DIR" \
	-maxdepth 1 \
	-type f \
	-name "${BACKUP_PREFIX}-*.dump" \
	-mtime "+$prune_mtime" \
	-delete

echo "Database backup created: $backup_file"
