# QA — Scheduling (shared)

**Phase:** 4.3. Verifies DM-proposed sessions + member RSVPs with a correct tally,
enforced by RLS (`schedule_sessions` / `schedule_rsvps`, migration 0026).

**Prerequisites:** shared prerequisites in [README.md](README.md). DM
`ejcaldwell06` + player `ejcaldwell.test` on "Test 1". Both open the
**Scheduling** tab.

## Steps — DM proposes & edits

- [x] As the **DM**: "Propose a session" form is visible. Add a title
      (e.g. "Session 12"), pick a date/time, notes → **Propose session** →
      appears in the list with the formatted date; indicator saves.
- [x] Edit the session's title/date/notes inline → debounced save; refresh →
      edits persist.
- [x] **Delete** a session (confirm) → gone for everyone.

## Steps — member RSVP & tally

- [x] As the **player**: no "Propose a session" form (DM-only). The session shows
      read-only title/date/notes.
- [x] Click **Yes** → your response highlights; the tally shows **Yes: 1 — <your
      name>**. Change to **Maybe** → tally moves.
- [x] As the **DM**, refresh → the tally reflects the player's response (name
      shown), and the DM can also set their own response.

## Steps — access (RLS)

- [x] As the **player** (member), writing a session is refused; RSVP for self ok:
      ```js
      const cid = 'd0e1fc8f-29d6-4381-9cd7-04c9214a80fa'
      await supabase.from('schedule_sessions').insert({ campaign_id: cid, title: 'x' }).select()  // → 403
      // sid = a real session id
      await supabase.from('schedule_rsvps').insert({ session_id: sid, user_id: '<me>', status: 'yes' }).select()  // → ok
      await supabase.from('schedule_rsvps').insert({ session_id: sid, user_id: '<other>', status: 'yes' }).select() // → 403 (not my row)
      ```
- [x] As a **non-member / anon**, `schedule_sessions` and `schedule_rsvps` select
      → `[]`.

## Pass criteria

DM can propose/edit/delete sessions; members RSVP (only their own) and everyone
sees an accurate tally with names; players can't write sessions or others' RSVPs;
non-members/anon see nothing.

## Run log

**2026-07-29 — PASS.** Campaign `d0e1fc8f…`.

- DM propose/edit/delete all work; **Today** quick-fill button added beside the
  date/time input in both the composer and each session's edit row.
- Member RSVP + live tally with names verified (DM refresh reflects the player's
  response).
- Access: player `schedule_sessions` insert → **403** (DM-only). ✓

### Bug found & fixed during QA
- **"Failed to load the schedule" after refresh** — `listRsvps` used a PostgREST
  embed `profiles(display_name)`, but `schedule_rsvps.user_id` FKs to
  `auth.users`, not `profiles`, so the embed had no resolvable relationship and
  threw once any session/rsvp existed. (Step 5's tally had only shown the
  optimistic local "You".) Fixed: fetch rsvps, then resolve names from `profiles`
  in a second query. **All pass.**
