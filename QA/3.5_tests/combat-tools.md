# QA — Combat tools (initiative + dice)

**Phase:** 3.5. Verifies the DM's initiative tracker and dice roller behave and
(for initiative) persist.

**Prerequisites:** shared prerequisites in [README.md](README.md). Sign in as the
DM (`ejcaldwell06@gmail.com`), open **"Test 1"**, **Combat** tab.

## Steps — initiative: add & seed

- [ ] Open **Combat** → an **Initiative** section (privacy note + add controls)
      and a **Dice roller** section below it.
- [ ] **+ Add combatant** → a blank row (initiative `—`, name, notes) appears;
      indicator shows **Saving… → All changes saved**.
- [ ] **+ Add party** → one row per player character, pre-named.
- [ ] **+ Add NPC…** picker → choosing a roster NPC adds a row with its name.

## Steps — initiative: edit, sort, step

- [ ] Set **initiative values** on several rows → the list **re-sorts live**,
      highest first (blank/unset rows sink to the bottom).
- [ ] Edit a **name** and **notes** → debounce to **All changes saved**.
- [ ] **Sort by initiative** → positions bake in to the current order.
- [ ] **Drag** a tied row by `⠿` to reorder → insertion bar; order holds.
- [ ] **Next turn ›** advances the **▶** current-turn marker down the list;
      wrapping past the last combatant increments **Round**. **‹ Prev** goes back
      (and decrements the round at the top). **Reset** → Round 1, first combatant.
- [ ] Remove a row with **✕**; **Clear** empties the list (with confirm).
- [ ] **Refresh** → combatants, initiative values, names, notes, and order
      persist. (The turn pointer/round reset — they're intentionally not saved.)

## Steps — dice roller

- [ ] Type `2d6+3` → **Roll** → a big total appears with a breakdown like
      `2d6 [x, y] + 3 = n`; the total is within 5–15.
- [ ] Quick buttons **d20 / d12 / d10 / d8 / d6 / d4 / d100** each roll that die;
      results are within range.
- [ ] Try `1d8+1d4+2` → both dice groups appear in the breakdown and sum right.
- [ ] Enter nonsense (e.g. `hello`, `2x6`) → a friendly **error**, no roll.
- [ ] Enter something huge (e.g. `999d999`) → an out-of-range **error** (no hang).
- [ ] Multiple rolls accumulate a **history** (newest first); it's not persisted
      across refresh (client-only).

## Pass criteria

Initiative combatants add (incl. seeding from party/NPCs), edit, sort by value,
drag-reorder, step through turns with a round counter, and persist on refresh;
the dice roller correctly rolls valid notation, rejects invalid/oversized input,
and keeps an in-session history.

## Run log

**2026-07-21 — PASS.** DM against campaign `d0e1fc8f…`, dev server on :5173.

- Initiative add/seed: **+ Add combatant** (blank row, Saving→saved), **+ Add
  party** (one row per PC), **+ Add NPC…** (named row) all worked.
- Edit/sort/step: live re-sort on initiative value (blanks sink), name/notes
  debounce, **Sort by initiative** bakes order, drag `⠿` reorders ties, turn
  stepper advances **▶** with **Round** increment on wrap, ✕/Clear work.
- Refresh: combatants/values/names/notes/order persisted; turn pointer + round
  reset as designed.
- Dice roller: `2d6+3`, quick d20…d100, `1d8+1d4+2` all rolled in range with
  correct breakdowns; `hello`/`2x6` and `999d999` gave friendly errors (no
  hang); history accumulated newest-first, cleared on refresh. **All pass.**

### Combat-tracker upgrades (HP tracker + inline NPC stats)

Added after the initial 3.5 build (migration `0023_initiative_hp_npc`: `hp`,
`max_hp`, `npc_id`). Verified in the same session:

- **HP box** shows `current / max` per combatant; numeric edits save immediately
  and persist on refresh.
- **+ Add NPC…** links the roster NPC (`npc_id`) and **auto-seeds HP** from an
  HP-labelled stat field (`27/30` → 27/30; single `27` → 27/27; none → blank).
- **▸ Stats** toggle on NPC-linked rows expands a read-only inline panel showing
  the NPC's **description** (attack write-ups) + full stat block (all
  sections/fields) — no tab-flipping. **All pass.**
