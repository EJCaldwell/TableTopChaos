# QA — Deferred: storage cap & 3-month cleanup

**Phase:** 1.5 (spec), but **not executable within 1.5** — both areas depend on
work that hasn't been built yet. This file records what must be tested and *where*
it will actually be verified, so the §1.5.3 criteria aren't silently dropped.

## Storage cap — blocked on Phase 1.6

**Criterion (§1.5.3):** during the trial the smaller storage cap applies; uploads
past `campaign_storage_cap()` are rejected server-side (not just hidden in the UI),
and the cap lifts to the paid value once `active`.

**Why deferred:** there is **no upload path yet**. The entitlement function
`private.campaign_storage_cap(campaign_id)` already exists (migration 0005:
trial ≈ 500 MB, paid ≈ 5 GB, and unlimited-of-concern while `enforce_active =
false`), but nothing writes image bytes to meter against it until the media
pipeline in **Phase 1.6**.

**Where it gets tested:** as part of **`QA/1.9_tests/`**. When 1.6 wires uploads,
that phase must:
- meter per-campaign bytes and block uploads over `campaign_storage_cap()` in the
  upload Edge Function / RLS (with `enforce_active = true`);
- confirm the trial cap vs paid cap difference;
- confirm a direct upload attempt (bypassing the UI) is also rejected.

## 3-month cleanup cron + warning emails — blocked on Phase 4.2

**Criterion (§1.5.3):** a campaign read-only for 3 months is deleted by a daily
cron; warning emails fire at 30 / 7 / 1 days left; reactivating or exporting
before the deadline prevents loss (use a test clock / shortened window).

**Why deferred:** the daily-cleanup Edge Function is **intentionally not built**.
Per §1.5.1, auto-deletion must not ship until campaign **export (Phase 4.2)**
exists, so a DM always has a way to save their data before deletion. The
transactional email provider (see the §1 email note) is also a later dependency.

**Where it gets tested:** alongside the cleanup cron when it's built (gated behind
**4.2**). That test will need a test clock or a shortened read-only window and
must verify: the 30/7/1-day warnings, the in-app countdown, that export/reactivate
cancels the deletion, and that only campaigns read-only for the full window are
removed (rows **and** Storage objects).

## Pass criteria

Not applicable to the 1.5 pass. These two items are considered **carried forward
with a documented reason** — closing Phase 1.5 does not require them, but they
remain on the checklist for 1.6 (storage) and 4.2/cleanup (cron) respectively.

> Functions already in place: `private.campaign_storage_cap` (migration 0005).
> Not yet built: the media upload pipeline (1.6) and the cleanup cron Edge
> Function (4.2 dependency).
