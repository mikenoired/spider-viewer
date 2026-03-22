#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

DATABASE_URL="${DATABASE_URL:-}"
DB_BACKUP_DIR="${DB_BACKUP_DIR:-/opt/spider-viewer/backups/postgres}"
DB_BACKUP_RETENTION_DAYS="${DB_BACKUP_RETENTION_DAYS:-7}"
PG_DUMP_BIN="${PG_DUMP_BIN:-}"
BACKUP_PREFIX="spider-viewer-postgres"

detect_pg_dump_bin() {
	local candidate
	local -a versioned_bins=()

	if [[ -n "$PG_DUMP_BIN" ]]; then
		if [[ ! -x "$PG_DUMP_BIN" ]]; then
			echo "PG_DUMP_BIN does not exist or is not executable: $PG_DUMP_BIN" >&2
			exit 1
		fi

		echo "$PG_DUMP_BIN"
		return
	fi

	while IFS= read -r candidate; do
		versioned_bins+=("$candidate")
	done < <(compgen -G "/usr/lib/postgresql/*/bin/pg_dump" | sort -V)

	if (( ${#versioned_bins[@]} > 0 )); then
		echo "${versioned_bins[-1]}"
		return
	fi

	if candidate="$(command -v pg_dump 2>/dev/null)"; then
		echo "$candidate"
		return
	fi

	echo "pg_dump was not found. Install PostgreSQL client tools or set PG_DUMP_BIN." >&2
	exit 1
}

if [[ -z "$DATABASE_URL" ]]; then
	echo "DATABASE_URL is required for database backups." >&2
	exit 1
fi

if ! [[ "$DB_BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || (( DB_BACKUP_RETENTION_DAYS < 1 )); then
	echo "DB_BACKUP_RETENTION_DAYS must be an integer greater than 0." >&2
	exit 1
fi

mkdir -p "$DB_BACKUP_DIR"

PG_DUMP_BIN="$(detect_pg_dump_bin)"

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

"$PG_DUMP_BIN" \
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
