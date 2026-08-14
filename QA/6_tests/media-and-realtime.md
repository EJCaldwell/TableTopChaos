# QA — Media & realtime after the migration

**Phase:** 6.3 / 6.5. **Browser — yours to run.** I cannot see or drive your
browser, so nothing here gets marked PASS without your reported result.

These two subsystems moved to different servers (`storage-api` and `realtime`) and
neither is exercised by a build.

Realtime is **already built and passing** — Phase 4.4 passed a two-session test on
2026-07-29 (see [`../4.4_tests/realtime.md`](../4.4_tests/realtime.md)), implemented
as row-level merges via `useRealtimeSync` + `mergeById`, not full re-fetches. So this
is a **regression check against a known-good baseline**, and 4.4's run log is the
reference for what "working" looked like. Re-run its scenarios, not just a generic
propagation test.

**Prerequisites**
- 6.2 passed; media re-uploaded through the Storage API.
- Two browsers (or a normal + private window) signed in as **different** users in the
  same campaign.
- A second campaign owned by someone else, with at least one image.

---

## Steps — media

- [ ] Existing portraits and encounter images render on load (these use
      `createSignedUrl` via the new `storage-api`).
- [ ] Upload a new image — succeeds, appears immediately, and survives a reload.
- [ ] Upload a WebP and a large photo. Both are handled (Phase 1.6 fixed a WebP
      no-op and an OOM via client-side resize + a server guard — confirm neither
      regressed on the new runtime).
- [ ] **Cross-campaign leak check — the important one.** Copy an image path from the
      *other* campaign and request it as a user with no membership. Must be denied.
      This is the `storage.objects` policy from migration 0008 doing its job; if it
      returns the image, storage access control did not survive the migration.
- [ ] A signed URL still fails after its expiry window.
- [ ] Storage usage in the UI matches reality (drives the billing cap).

## Steps — realtime

- [ ] **Re-run the four Phase 4.4 scenarios** with two sessions (DM + player) on the
      same campaign — each must still merge the changed row in place, not full-reload:
      player HP/condition → DM's Party HP block; share/un-share → "Shared with us"
      card; DM-proposed session + player RSVP → live tally; initiative edit → merged
      row in a second DM tab.
- [ ] Channel teardown still clean: switch tabs away and back, confirm updates keep
      working with **no duplicate refreshes** (channels removed on unmount).
- [ ] Verify the WebSocket actually connects: DevTools → Network → WS shows a
      `/realtime/v1/websocket` connection in state 101, not a failed handshake.
      Caddy upgrades WebSockets automatically, so a failure here points at the
      Realtime service config (it refuses to boot without correctly-sized
      `DB_ENC_KEY` / `SECRET_KEY_BASE`).
- [ ] **Realtime respects RLS.** As a *player* session, confirm you receive no
      change events for DM-only tables. Realtime replays `postgres_changes` from a
      publication — if the publication was created `for all tables`, DM-only rows
      would stream to every subscribed client. `railway/init/` deliberately creates
      it empty for this reason, and migration 0027 adds the intended tables.
      **Gate: exactly these 5 and no others** (verified live 2026-08-04) —
      `character_status`, `initiative_entries`, `schedule_rsvps`,
      `schedule_sessions`, `shared_items`:
      ```sql
      select tablename from pg_publication_tables
       where pubname = 'supabase_realtime' order by tablename;
      ```
- [ ] Closing a session cleans up (no console errors from `removeChannel`).

## Pass criteria

Existing media renders, new uploads work including WebP and large files, **the
cross-campaign path request is denied**, and the two-session realtime test propagates
a change with a live WS connection while leaking no DM-only events to players.

## Run log

_No runs yet._
