#!/bin/sh
# ---------------------------------------------------------------------------
# cleanup.sh — daily trigger for the cleanup-campaigns Edge Function.
#
# Owns: one HTTP call per run, and turning a non-2xx response or an `errors`
# array into a FAILED Railway deploy so a silently broken sweep is visible.
#
# WHY A CRON SERVICE RATHER THAN pg_cron: the work is not SQL. It cancels Stripe
# subscriptions, deletes Storage objects and calls Resend — none of which
# Postgres can reach. The database only holds the clock; the Edge Function does
# the parts that touch the outside world.
#
# WHY IT DOES SO LITTLE: every safety decision lives in SQL and in the function,
# where it can be tested. This script must stay dumb enough that "the cron is
# wrong" is never a plausible diagnosis.
#
# Required variables (Railway service):
#   CLEANUP_URL     — https://<gateway>/functions/v1/cleanup-campaigns
#   CLEANUP_SECRET  — must match the CLEANUP_SECRET on the `functions` service
# Optional:
#   CLEANUP_DRY_RUN — "true" to report without sending mail or deleting. Set it
#                     for the first production cycles; the log then shows exactly
#                     what a real run would have done.
#
# Schedule: daily. NOT hourly — the thresholds are whole days, so a second run
# in the same day can only re-send a warning that was already recorded, and the
# monotonic guard in record_lapse_warning() would reject it anyway.
# ---------------------------------------------------------------------------
set -eu

: "${CLEANUP_URL:?CLEANUP_URL is required}"
: "${CLEANUP_SECRET:?CLEANUP_SECRET is required}"
DRY="${CLEANUP_DRY_RUN:-false}"

echo "cleanup: POST $CLEANUP_URL (dryRun=$DRY)"

# -w writes the status on its own final line so body and status can be split
# without needing jq. --fail is deliberately NOT used: on a 4xx/5xx it would
# discard the body, and the body is where the reason is.
RESPONSE=$(curl -sS -X POST "$CLEANUP_URL" \
  -H "x-cleanup-key: $CLEANUP_SECRET" \
  -H "content-type: application/json" \
  -d "{\"dryRun\": $DRY}" \
  -w '\n%{http_code}')

STATUS=$(printf '%s' "$RESPONSE" | tail -n1)
BODY=$(printf '%s' "$RESPONSE" | sed '$d')

echo "cleanup: HTTP $STATUS"
echo "$BODY"

if [ "$STATUS" != "200" ]; then
  echo "cleanup: FAILED — sweep returned $STATUS" >&2
  exit 1
fi

# A 200 carrying a non-empty errors array means some campaigns were skipped —
# most likely warning emails that could not be delivered. Nothing was deleted
# for those (the interlock holds), but it must not scroll past as a green run:
# undelivered warnings are the failure this whole design exists to prevent.
if printf '%s' "$BODY" | grep -q '"errors":\[[^]]'; then
  echo "cleanup: FAILED — sweep reported errors (see the body above)" >&2
  exit 1
fi

echo "cleanup: done"
