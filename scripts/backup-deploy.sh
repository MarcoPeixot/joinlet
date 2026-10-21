#!/usr/bin/env sh
set -eu
# Run from the release checkout, e.g. hourly via cron. Set JOINLET_BACKUP_DEST to an off-host mounted target.
cd "$(dirname "$0")/.."
: "${JOINLET_BACKUP_DEST:?Set JOINLET_BACKUP_DEST to a private backup directory (preferably off-host)}"
umask 077
mkdir -p "$JOINLET_BACKUP_DEST"
backup_name="joinlet-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
container_path="/data/backups/$backup_name"
docker compose --env-file deploy/.env.production -f deploy/compose.yml exec -T joinlet bun apps/remote/src/backup.ts /data/remote.sqlite "$container_path"
# cp uses the container's completed, verified snapshot. Never copy the live SQLite/WAL file.
docker compose --env-file deploy/.env.production -f deploy/compose.yml cp "joinlet:$container_path" "$JOINLET_BACKUP_DEST/$backup_name"
chmod 600 "$JOINLET_BACKUP_DEST/$backup_name"
docker compose --env-file deploy/.env.production -f deploy/compose.yml exec -T joinlet bun -e 'import {unlinkSync} from "node:fs"; const path=process.argv[1]; if(!/^\/data\/backups\/joinlet-\d{8}T\d{6}Z\.sqlite$/.test(path)) throw Error("Invalid backup path"); unlinkSync(path);' "$container_path"
printf 'Joinlet snapshot copied to %s\n' "$JOINLET_BACKUP_DEST/$backup_name"
