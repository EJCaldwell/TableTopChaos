# Manual checklist — Workspace shell (Phase 5.2)

**Phase:** 5.2 — Mode-aware app shell
**Run by:** the user, in the browser on :5173.

One chrome in every mode, so this runs against both a Note taker and a Playspace
campaign; differences are called out per step. **No console needed.**

## Prerequisites

- Campaign **"Main Test"**, starting on **Note taker**.
- DM `ejcaldwell06`; player `ejcaldwell.test` in a second browser/profile.
- If you ran an earlier 5.2 build, your saved layout is from a shell that no
  longer exists. Steps 1–3 assume a **fresh** layout, so before starting, open
  the campaign and use **⊘ Close tabs** if anything is already open.

## Steps

### Header & frame (Note taker, DM)

- [ ] 1. Open "Main Test". The **campaign name is centred in the top app bar**,
      with a small **DM** badge beside it. There is **no separate campaign title
      bar** below it, and **no "Switch to" dropdown anywhere**.
- [ ] 2. The workspace **fills the browser window** — app header, then the rail
      and workspace area down to the bottom edge. **The page itself does not
      scroll**; panels scroll inside their own windows.
- [ ] 3. The **rail is on the RIGHT** by default, with the workspace to its left.
- [ ] 3b. **Overview opened by itself**, because you came in from the dashboard.
      Close it, then **reload the page**: it should **not** reappear (a refresh
      isn't "entering from the main menu"). Go back to the dashboard and click
      into the campaign again → it opens once more.
- [ ] 3c. The rail's **bottom** holds, in order: **⊘ Close tabs** in **red**, then
      a divider, then **Settings** as the very last entry. **Overview is not in
      the rail at all**, top or bottom.
- [ ] 3d. **"Campaign overview" is a button in the top app bar**, immediately
      right of the "TableTopChaos" home link. Close the Overview window,
      then click it → the window reopens. Click it **again while it's already
      open and buried** behind another window → it comes to the **front**, and
      you never get two Overview windows.
- [ ] 3e. **Scheduling is no longer a rail entry.** It is a section at the
      **bottom of Overview**. Open Overview and confirm the scheduling UI is
      there and works — propose/confirm a session date as you would have on the
      old tab, and confirm it persists across a refresh.

### Click-to-open (the 5.2.1c model)

- [ ] 4. Click a rail section — e.g. **NPCs**. It opens **immediately as a
      floating window**. There is no docked panel and no second "pop out" click.
- [ ] 5. Click **another** section. It opens as a *second* window, offset from the
      first, and both stay open.
- [ ] 6. A rail entry is a **three-way toggle**. With the first window buried
      behind the second: clicking its rail entry **brings it to the front**;
      clicking that same entry again (now that it's frontmost) **closes it**.
- [ ] 7. Open sections are marked in the rail (accent bar, bolder text) and the
      marker clears when you close them.
- [ ] 8. The window's **✕** closes it too. There is **no ⇤ dock button** any more.

### Windows

- [ ] 9. **Drag** by the title bar — smooth, and it can't be dragged fully out of
      reach; some title bar always stays grabbable.
- [ ] 10. **Resize from every edge and corner.** The one to watch: dragging the
      **top or left** edge moves that edge while the opposite edge stays pinned,
      and both stop cleanly at minimum size rather than sliding sideways.
- [ ] 11. Panels are fully usable in a window — in **NPCs**, add / edit / delete
      one. Long panels scroll inside the window.
- [ ] 12. With three or four windows open, clicking any one **brings it to the
      front**, and they can overlap freely.

### Rail controls

- [ ] 13. **Move the rail — now from Settings.** There is **no ⇤/⇥ button in the
      rail** any more. Open **Settings → Workspace → Sidebar position** and pick
      **Left** → the whole rail moves, and the divider and accent markers move
      with it so they still face the workspace. Pick **Right** to move it back.
      Windows stay where they were.
- [ ] 14. **Resize the rail.** Drag its **inner edge** (the one facing the
      workspace) — the cursor becomes a horizontal resize arrow. It widens and
      narrows, stopping at sensible min/max rather than vanishing or eating the
      workspace. **Double-click** that edge resets it to the default width.
- [ ] 15. Move the rail to the other side (**⇤**/**⇥**) and confirm the grab strip
      **moved with it** — it is always on the workspace-facing edge, and dragging
      still grows the rail in the direction you'd expect.
- [ ] 16. **Collapse** narrows the rail to single letters; expanding restores it
      **at the width you dragged it to** (collapsing must not forget your size).
      While collapsed there is **no resize cursor** on the edge. Collapsed,
      hovering a letter shows the section name, and the collapse chevron points
      the sensible way for whichever side the rail is on.
- [ ] 17. **Close tabs.** With three windows open the rail's footer shows
      **⊘ Close tabs (3)** in red. Click → all close at once. The rail **stays
      expanded, at its width, and on the same side** (closing tabs must not hide
      or move the way back).
- [ ] 18. With nothing open the button is **still there**, in the same place, but
      **dimmed and unclickable** — it never disappears, and never silently does
      nothing. Open one → it brightens and reads **(1)**.
- [ ] 18b. **Reset layout.** Open some windows, drag the rail wider, move it left.
      Settings → Workspace → **Reset layout** → everything closes and the rail
      returns to its default width, expanded, on the right.
- [ ] 19. Console stays clean throughout, including during drags and resizes.

### Persistence

- [ ] 20. Open three windows, drag/resize them to distinctive spots, move the rail
      to the left and collapse it. **Hard-refresh** (Cmd-Shift-R) → all three
      windows return at the **same positions, sizes and stacking order**, and the
      rail is still collapsed on the left.
- [ ] 21. Go to the dashboard and back → same arrangement. Open a **different**
      campaign → it has its own independent (default, right-hand) layout; return
      to "Main Test" → yours is intact.

### Playspace / RPG

- [ ] 22. Settings → Game mode → **Playspace**. Re-frames **immediately without a
      refresh**: the workspace area now reads "The playspace goes here" naming the
      mode, with your windows floating over it. Rail, click-to-open, drag, resize
      and Close tabs all still work.
- [ ] 22b. **Overview is reachable in playspace mode too** — click **Campaign
      overview** in the header and confirm it opens over the playspace, scheduling
      and all.
      This is the case 5.2.1h was for: with the map owning the middle, having to
      round-trip through the dashboard to see the roster would be a real dead end.
- [ ] 23. Close tabs → the playspace has the **whole** area beside the rail.
- [ ] 24. Switch to **Full RPG** → same shell, placeholder copy mentions the
      combat tracker. Then switch back to **Note taker**.

### Plan & billing moved (5.2.1b)

- [ ] 25. There is **no "Plan & billing" entry in the rail** for the DM.
- [ ] 26. **DM** Settings has six blocks in order: **Workspace**, **Campaign
      name**, **Game mode**, **Plan & billing**, **Backup & data**, **Danger
      zone**. Billing shows the same status and actions it did as a tab.

### Player

- [ ] 27. As the **player**: the header shows the campaign name with a **Player**
      badge. They also get the **Campaign overview** button in the header. The
      rail lists player sections only — no DM sections — and ends with **Close
      tabs** and **Settings**. Click-to-open, drag,
      resize, collapse and Close tabs all work for them.
- [ ] 27b. **Player Settings shows exactly ONE section: Workspace** (sidebar
      position + reset layout). **No campaign name, no game mode, no plan &
      billing, no backup, no danger zone.** Their sidebar-position control works
      and is independent of the DM's.
- [ ] 27c. The player also gets Overview auto-opening on entry from the dashboard,
      the header button, and the **scheduling section inside Overview** — confirm
      they can see and use scheduling there.
- [ ] 28. Player writes still work — **HP & conditions**: change current HP,
      refresh, it stuck.

Leave "Main Test" on **Note taker** when you're done.

## Pass criteria

The campaign name sits centred in the app header with no title bar and no
switcher; the workspace fills the window; the rail starts on the right and can be
moved to the left from Settings, resized by dragging its inner edge, and
collapsed; its footer always shows a red Close tabs (disabled when nothing is
open) and Settings below a divider; Campaign overview is a header button —
reachable from anywhere including a playspace campaign — which also opens on
entry from the dashboard and holds the roster, invite codes and scheduling; players get Settings with the Workspace section only; clicking a rail section opens it
directly as a floating window and the entry then toggles raise → close; windows
drag anywhere in the region and resize from any edge or corner; several panels are
usable at once; the arrangement survives a refresh and is per campaign;
`playspace`/`rpg` reserve the area for the battlemap; role gating is unchanged;
Plan & billing lives only in Settings; nothing errors in the console.

## Run log

**2026-08-07 — PASS (Phase 5.2.1 — SUPERSEDED, does not describe shipping
behavior).** The user ran the original 5.2.1 build, in which `notetaker` kept the
top tab bar and only `playspace`/`rpg` used a sidebar. They reported all steps
good across `notetaker-regression.md` (7 steps — the tab bar was untouched for
both roles, panels rendered, writes worked, tab persistence held) and the then
`playspace-shell.md` (16 steps — rail, drawer, collapse, pop-out, drag, resize,
focus-to-front, dock, close, and the never-in-two-places invariant). Console clean.

> **Superseded twice since, so this file has NOT been run in its current form.**
> - **5.2.1b (2026-08-10)** — billing moved into Settings; all-edge resize; the
>   workspace went full-bleed; and `notetaker` adopted the same shell, deleting
>   the top tab bar (which retired `notetaker-regression.md` entirely).
> - **5.2.1c (2026-08-10)** — the campaign title bar and the in-workspace campaign
>   switcher were removed, the campaign name moved into the app header's centre
>   slot, the rail became side-switchable and now **starts on the right**, and
>   **clicking a rail entry opens the panel directly as a floating window**. The
>   docked panel is gone altogether, taking the ⧉ pop-out and ⇤ dock buttons with
>   it.
>
> The 2026-08-07 result is preserved per the run-log convention, but **nothing in
> the checklist above has current browser evidence.** It needs a full fresh run.
