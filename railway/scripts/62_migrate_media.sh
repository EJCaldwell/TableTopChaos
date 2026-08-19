#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# 62_migrate_media.sh — Phase 6.2 step 3: move the media bucket.
#
# Owns: copying every object in the source `media` bucket to the self-hosted
# stack, downloading and re-uploading **through the Storage API on both ends**.
#
# WHY NOT COPY THE FILES ONTO THE VOLUME: access to media is enforced by an RLS
# policy on `storage.objects` (migration 0008), so a file on disk with no row in
# that table is invisible to the app — and a row written by hand is a guess at
# storage-api's internal schema. Letting the service that owns the table write
# its own rows is the only version that stays correct across versions.
#
# Object paths are preserved exactly, because `media_assets.storage_path` in the
# restored data points at them. A renamed object is a broken image.
#
# Note each upload is two objects: `<campaign>/<asset>/original.webp` and
# `.../thumb.webp`. Only the original is recorded in `media_assets`; the thumb
# is found by convention. Anything that filters this list must keep pairs
# together or portraits render broken.
#
# Usage: railway/scripts/62_migrate_media.sh
# Reads: railway/.env.migrate (SOURCE_SERVICE_ROLE_KEY, SOURCE_PROJECT_REF)
#        railway/.env.stack   (SERVICE_ROLE_KEY for the local gateway)
# Never echoes either key.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/../.."

# STACK_ENV_FILE selects which destination stack to upload into: the local
# compose stack by default, or railway/.env.stack.production for the deployed
# one. LOCAL_GATEWAY is the destination Storage API origin (misnamed now that it
# can be a public Railway domain, kept for compatibility with the local runs).
set -a; . railway/.env.migrate; set +a
set -a; . "${STACK_ENV_FILE:-railway/.env.stack}"; set +a
: "${SOURCE_SERVICE_ROLE_KEY:?empty in railway/.env.migrate}"
: "${SOURCE_PROJECT_REF:?empty in railway/.env.migrate}"
: "${SERVICE_ROLE_KEY:?empty in railway/.env.stack}"

SRC="https://${SOURCE_PROJECT_REF}.supabase.co/storage/v1"
DST="${LOCAL_GATEWAY:-http://localhost:8000}/storage/v1"
OUT=railway/migrate-out
CACHE="$OUT/media"
LIST="$OUT/source_objects.txt"

[ -f "$LIST" ] || { echo "error: $LIST missing — run 62_dump_source.sh first" >&2; exit 1; }
mkdir -p "$CACHE"

# --- Ensure the destination bucket exists ---------------------------------
# Migration 0008 inserts the `media` bucket row, so on a stack that replayed the
# migrations this already exists and the create is a no-op. Tolerated rather
# than skipped so the script also works against a stack built another way.
curl -s -o /dev/null -X POST "$DST/bucket" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "content-type: application/json" \
  -d '{"id":"media","name":"media","public":false,"file_size_limit":10485760,
       "allowed_mime_types":["image/png","image/jpeg","image/webp","image/gif"]}' || true

total=0; ok=0; failed=0
while IFS= read -r obj; do
  [ -n "$obj" ] || continue
  total=$((total + 1))
  local_file="$CACHE/$obj"
  mkdir -p "$(dirname "$local_file")"

  # Download once and keep it: re-running after a partial failure should not
  # re-pull 106 files, and the cache is the evidence for the byte-size check.
  # BOTH headers, deliberately. Supabase's newer `sb_secret_…` keys are accepted
  # only in `apikey`; sending them as `Authorization: Bearer` returns 400 on
  # every request. Legacy JWT-style service_role keys accept either, so sending
  # both is the one form that works regardless of which key the project issues.
  if [ ! -s "$local_file" ]; then
    code=$(curl -s -o "$local_file" -w '%{http_code}' \
      "$SRC/object/media/$obj" \
      -H "apikey: $SOURCE_SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SOURCE_SERVICE_ROLE_KEY")
    if [ "$code" != "200" ]; then
      echo "  DOWNLOAD FAIL [$code] $obj" >&2
      rm -f "$local_file"; failed=$((failed + 1)); continue
    fi
  fi

  # x-upsert so a re-run overwrites rather than 409s halfway through.
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$DST/object/media/$obj" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "x-upsert: true" \
    -H "content-type: image/webp" \
    --data-binary "@$local_file")

  case "$code" in
    200|201) ok=$((ok + 1)) ;;
    *) echo "  UPLOAD FAIL [$code] $obj" >&2; failed=$((failed + 1)) ;;
  esac

  [ $((total % 20)) -eq 0 ] && echo "  … $total processed"
done < "$LIST"

echo
echo "objects listed:   $total"
echo "uploaded ok:      $ok"
echo "failed:           $failed"

# --- Gate: object count and per-campaign usage ----------------------------
DB="${TARGET_DB:-postgres://postgres:${POSTGRES_PASSWORD}@localhost:54322/postgres}"
echo
echo "==> destination storage.objects: $(psql "$DB" -tAc 'select count(*) from storage.objects')"
echo "==> per-campaign storage used (must match the pre-migration baseline):"
psql "$DB" -tAc "select c.id || ' = ' || private.campaign_storage_used(c.id) from public.campaigns c order by 1"

[ "$failed" -eq 0 ] || exit 1
