# QA — Phase 3.2 automated coverage

Same posture as prior phases: no unit-test runner, so automated coverage is the
**type-checker + build**; substantive verification is the manual checklists.

## What runs

- `npm run typecheck` (`tsc -b --noEmit`) — includes `NpcsPanel`,
  `EncountersPanel`, the `npcsApi` / `encountersApi` modules, the shared
  `useDragReorder` hook, and the regenerated `npcs` / `npc_stat_sections` /
  `npc_stat_fields` / `encounters` / `encounter_images` / `encounter_npcs` types.
- `npm run build` — production build succeeds (advisory >500 kB chunk warning
  only).

## What automated coverage does NOT prove

- **RLS / DM-only access** — that players and anon can read/write none of the six
  tables, and that the DM has full CRUD — verified through the real client per
  account in [access-control.md](access-control.md).
- **Image upload / presentation / NPC linking / stat-block editing** — UI
  behavior, verified manually in the editing + presentation checklists.

## Notes

- All six tables enforce access on the campaign's DM for *all four* operations:
  `npcs` / `encounters` via `is_campaign_dm(campaign_id)`; `npc_stat_sections` via
  `is_npc_dm`; `npc_stat_fields` via `is_npc_section_dm`; `encounter_images` /
  `encounter_npcs` via `is_encounter_dm` (all SECURITY DEFINER, migration 0020).
- Supabase security advisors reported **no new findings** for the six tables
  after migration 0020 (RLS enabled with policies on all).
- This subphase also delivers the **Phase 3.3 shared NPC roster** (the `npcs`
  table + NPCs tab); 3.3's quest tracker remains outstanding.
