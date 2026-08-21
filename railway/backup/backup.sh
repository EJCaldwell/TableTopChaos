#!/bin/sh
# ---------------------------------------------------------------------------
# backup.sh — nightly logical backup of the self-hosted Postgres.
#
# Owns: one `pg_dump` per run, written gzipped to the attached volume, plus
# retention pruning. Runs as a Railway cron service (see railway/DEPLOY.md).
#
# WHY THIS EXISTS: self-hosting gives up Supabase's automatic daily backups.
# Nothing else in this stack would notice the loss until a restore was needed,
# which is the worst possible moment to discover there is nothing to restore.
#
# Dumps the WHOLE database, not just `public`. `auth.users` is owned by GoTrue
# and `storage.objects` by storage-api, but both are load-bearing: a backup that
# restores the campaigns and not the users who own them is not a backup, and
# every campaign FKs to auth.users(id).
#
# --no-owner / --no-privileges: role names differ between environments, and the
# grants come from railway/scripts/90_grant_app_privileges.sql on restore. Their
# absence keeps a restore from failing on "role does not exist".
#
# NOTE ON DURABILITY: the volume lives on the same provider as the database it
# backs up, so this protects against a bad migration, a dropped table or a
# botched deploy — NOT against losing the Railway account or a region. Copying
# these off-platform is tracked in PRE_LAUNCH.md.
# ---------------------------------------------------------------------------
set -eu

: "${BACKUP_DB_URL:?BACKUP_DB_URL is required}"
DIR=/backups
KEEP="${BACKUP_KEEP:-14}"

mkdir -p "$DIR"
FILE="$DIR/tabletopchaos-$(date +%Y%m%d-%H%M%S).sql.gz"

echo "backup: dumping to $FILE"
# Pipe through gzip rather than pg_dump -Fc: a gzipped plain dump can be read
# and partially recovered with nothing but psql, which matters when you are
# already in trouble.
pg_dump "$BACKUP_DB_URL" --no-owner --no-privileges | gzip -9 > "$FILE"

SIZE=$(wc -c < "$FILE")
echo "backup: wrote $SIZE bytes"

# A dump far smaller than expected usually means pg_dump failed midway while
# gzip still produced a valid (empty) file. Fail loudly so the deploy is marked
# failed rather than silently "succeeding" with a useless dump.
if [ "$SIZE" -lt 20000 ]; then
  echo "backup: FAILED — dump is implausibly small ($SIZE bytes)" >&2
  exit 1
fi

# Retention: keep the newest $KEEP, delete the rest.
COUNT=$(ls -1 "$DIR"/*.sql.gz 2>/dev/null | wc -l)
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1t "$DIR"/*.sql.gz | tail -n +"$((KEEP + 1))" | while read -r old; do
    echo "backup: pruning $old"
    rm -f "$old"
  done
fi

echo "backup: done — $(ls -1 "$DIR"/*.sql.gz | wc -l) dumps retained"
