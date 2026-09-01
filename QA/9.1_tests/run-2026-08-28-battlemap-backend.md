# Run log — Battlemap backend (9.1.1), 2026-08-28

**PASS — server-side.** Migration `0048_playspace_maps_tokens.sql` applied; 16 new
assertions added to the Phase 8.2 matrix, which now runs **79/79** and is baked
into the `migrate` image, so these re-run on every future schema change.

No UI yet — 9.1.2 builds the canvas. Nothing here is visible in the app.

## The rule that matters

A player may move **only their own token**. Verified in both directions:

| Persona | Assertion | |
|---|---|---|
| player | sees the active map | PASS (1) |
| player | sees **all** tokens on it | PASS (3) |
| player | can move their OWN token | PASS |
| player | cannot move a peer's token | PASS — 0 rows |
| player | cannot move the DM's monster | PASS — 0 rows |
| player | **cannot seize the DM's monster by claiming it** | PASS — 0 rows |
| player | **cannot give their token away** | PASS — 42501 |
| player | **cannot orphan their token to DM control** | PASS — 42501 |
| player | cannot create a token for somebody else | PASS — 42501 |
| player | cannot delete a peer's token | PASS — 0 rows |
| player | cannot edit the map | PASS — 0 rows |
| DM | can move ANY token | PASS |
| DM | can edit the map | PASS |
| non-member | sees no map / no tokens | PASS (0/0) |
| — | a SECOND active map is refused | PASS — 23505 |

The three bolded rows are why the UPDATE policy carries **both** `using` and
`with check`, and they are not redundant:

- `using` decides which existing rows you may touch — without it, a player edits
  the DM's dragon.
- `with check` decides what the row may look like afterwards — without it, a
  player sets `owner_user_id` to someone else and gives their token away, or to
  NULL and makes it DM-controlled.

Each hole is invisible to the other clause. A policy with only one of them passes
a naive "can a player move another token?" test and still leaks.

## The read-only lock — and what it exposed

These are the **first content-table policies in the project** to gate writes on
`private.campaign_is_active()`. Verified against a lapsed campaign with
`enforce_active = true`:

```
READ while lapsed        -> 1 map visible : PASS content preserved
MOVE TOKEN while lapsed  -> refused (42501) : PASS frozen
EDIT MAP while lapsed    -> 0 rows : PASS frozen
```

Writing that check revealed that **no other table has it**: 0 of 69 write
policies call `campaign_is_active`. QA/1.5_tests/read-only-lock.md had instructed
every later phase to add it; Phases 2–4 did not, and nothing caught it because
`enforce_active` is false so the function returns true for everything.

After the launch flip a lapsed campaign would stay fully writable, and the Refunds
page's "nobody can write" would be false. Recorded in PRE_LAUNCH as a blocker on
the flip; migration 0048 is the pattern to copy.

## Four design decisions

Written out because each is cheap to change now and expensive once a canvas sits
on top of it.

1. **Token position is in PIXELS**, not grid cells. A battlemap image usually has
   its own grid drawn on it, so `grid_size` aligns the overlay to the picture
   rather than defining the coordinate system — and off-grid placement (between
   squares, a swarm, a prone body) is common. **Consequence: changing `grid_size`
   does NOT re-snap existing tokens.**
2. **`owner_user_id` is the sole authority.** `character_id` / `npc_id` are links
   for display, not permission. Deriving ownership through a character would
   couple token permissions to a table whose own policies differ. NULL owner =
   DM-controlled.
3. **Map dimensions are explicit**, not read from the image. The server never
   decodes the file, and a DM can present a crop or extend past the artwork.
4. **One active map per campaign**, enforced by a partial unique index. A
   database invariant rather than a convention that application code can drift
   from. Inactive maps stay for prep.

## Owner revisions (0050) — verified

Three changes requested after reviewing the data model:

| | |
|---|---|
| **Five maps per campaign**, not unlimited | 5 allowed; a 6th refused with *"A campaign can have at most 5 maps. Delete one first."* |
| **Swap the live map in one action** | `update … set is_active = true where id = …` — a trigger clears the others; exactly one active afterwards, and it is the one chosen |
| **NPC tokens are DM-controlled unless relinquished** | NULL owner = DM; handing to a **member** works; handing to a **non-member** refused; reclaiming to NULL works |

The map-switch trigger exists because 0048's partial unique index made switching a
two-step dance — deactivate the old, then activate the new, **in that order**, or
the index rejects the write. A DM clicking a map in a list should not have to know
that. The index is still the invariant; the trigger just removes the ordering
trap.

The membership check on `owner_user_id` closes a real hole: the DM's UPDATE policy
already let them set it to anybody, so without it a token could be handed to a
stranger or a former member — leaving a token nobody present can move and the
roster cannot explain. Setting it back to NULL skips the check, so reclaiming is
never blocked by a lookup for someone who has since left.

**Grid size needed no schema change.** The DM uploads the picture first and then
adjusts the overlay to match it, which is exactly what a pixel-space `grid_size`
supports. The upload-then-adjust workflow is UI and lands in 9.1.2.

## The read-only lock sweep (0049) — and the bug it caught in 0048

Writing 0048's lock revealed that no other table had it. Migration 0049 swept
every content table: **73 of 78 write policies** now consult
`campaign_is_active`, via new write-only predicates (`dm_can_write`,
`owner_can_write_character`, …).

**Reads were deliberately untouched.** The promise is "read everything, write
nothing", so the lock could NOT simply be added to `is_campaign_dm` or
`can_write_character` — those are shared with SELECT policies, and locking them
would have *hidden* a lapsed campaign's content instead of freezing it.

Five exclusions, each because locking it would make a lapsed campaign
unrecoverable or punish the wrong person:

| Excluded | Why |
|---|---|
| `campaigns` INSERT | a new campaign has no subscription, so locking this makes creating one impossible once enforcement is on |
| `campaigns` UPDATE | settings and the billing screen live here — freezing them at the moment the owner is deciding whether to pay |
| `campaign_members` DELETE | leaving must always work; trapping players because the DM stopped paying is a hostage situation, not a paywall |
| `invite_codes` DELETE | revoking a code is a safety action |
| `profiles` UPDATE | not campaign-scoped at all |

**0049's assertion caught a bug in 0048, written an hour earlier.** Both token
DELETE policies had been locked for INSERT and UPDATE but not DELETE — so a
player in a lapsed campaign could still remove their token. Fixed in the same
migration. That is the assertion doing exactly its job, on its author.

The 8.2 matrix now carries a **lapsed-campaign persona** (reads work, writes
refused, plus a PAID control so "everything is frozen" cannot pass by accident,
plus "a player can still leave"). **96 assertions, all passing**, running on
every schema change.

## Not done here

- The canvas, drag, snapping and live sync — 9.1.2.
- Anything a browser can see. `playspace_maps` / `playspace_tokens` are in the
  realtime publication with `REPLICA IDENTITY FULL`, but nothing subscribes yet.
- Game-mode gating: maps are only meaningful in `playspace` / `rpg` campaigns,
  and per migration 0028 that is gated at read time in the UI, not in RLS.
