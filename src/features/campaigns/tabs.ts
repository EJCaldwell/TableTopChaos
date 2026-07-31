/**
 * campaigns/tabs.ts — the tab catalog for the campaign workspace shell (1.4).
 *
 * Owns: the single source of truth for which tabs exist, who can see each one,
 * and a short blurb describing what that tab will eventually hold. The shell
 * (CampaignPage) filters this list by the caller's role to build a role-aware
 * tab bar. Most tabs are placeholders in Phase 1 and get real content in later
 * phases; keeping them here means later phases only swap a placeholder for a
 * real panel without touching the shell's gating logic.
 *
 * Visibility here is a UI convenience (defense-in-depth); the authoritative
 * access control is always Row-Level Security on the underlying data.
 */

/**
 * Who a tab is shown to.
 *  - 'all'    — every member (DM and player), e.g. Overview and shared tools.
 *  - 'dm'     — DMs only (encounters, secret notes, the party sheet view…).
 *  - 'player' — players only (their personal character workspace). A DM reaches
 *               player data through the DM-only "Party" tab instead, so DMs do
 *               not get these personal tabs themselves.
 */
export type TabAudience = 'all' | 'dm' | 'player'

/**
 * A single workspace tab.
 *  - key:      stable id used for routing/selection (never shown to the user).
 *  - label:    the tab's visible name.
 *  - audience: which role(s) see it (see TabAudience).
 *  - blurb:    one line describing what the tab will hold; shown in the
 *              placeholder until the real panel ships.
 */
export interface WorkspaceTab {
  key: string
  label: string
  audience: TabAudience
  blurb: string
}

/**
 * The full ordered tab catalog. Order here is the order in the tab bar. Grouped
 * as: shared-to-all, DM-only, player-only. Only "overview" has real content in
 * Phase 1.4; the rest render the coming-soon placeholder.
 */
export const WORKSPACE_TABS: WorkspaceTab[] = [
  // Shared — visible to everyone in the campaign.
  {
    key: 'overview',
    label: 'Overview',
    audience: 'all',
    blurb: 'Campaign roster, invite codes, and campaign settings.',
  },
  {
    key: 'schedule',
    label: 'Scheduling',
    audience: 'all',
    blurb: 'Plan and confirm upcoming session dates with the party.',
  },

  // DM-only tabs.
  {
    key: 'billing',
    label: 'Plan & billing',
    audience: 'dm',
    blurb: 'Manage this campaign’s Pro trial and subscription.',
  },
  {
    key: 'party',
    label: 'Party',
    audience: 'dm',
    blurb: "A DM's-eye view of every player's character sheet and status.",
  },
  {
    key: 'encounters',
    label: 'Encounters',
    audience: 'dm',
    blurb: 'Build and stage encounters to run during the session.',
  },
  {
    key: 'npcs',
    label: 'NPCs',
    audience: 'dm',
    blurb: 'A roster of the NPCs in your world, with private DM notes.',
  },
  {
    key: 'combat',
    label: 'Combat',
    audience: 'dm',
    blurb: 'Live initiative and combat tracker for running fights.',
  },
  {
    key: 'quests',
    label: 'Quests',
    audience: 'dm',
    blurb: 'Track active quests, plot threads, and their status.',
  },
  {
    key: 'sessionlog',
    label: 'Session log',
    audience: 'dm',
    blurb: 'Session recaps and a running log of what happened at the table.',
  },
  {
    key: 'handouts',
    label: 'Handouts',
    audience: 'dm',
    blurb: 'Prepare handouts and lore to reveal to the party or individuals.',
  },
  {
    key: 'secretnotes',
    label: 'Secret notes',
    audience: 'dm',
    blurb: 'Private DM-only notes and hidden information, never shown to players.',
  },

  // Player-only tabs — the player's personal character workspace.
  {
    key: 'character',
    label: 'My character',
    audience: 'player',
    blurb: 'Your character sheet: stats, and core details.',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    audience: 'player',
    blurb: 'The gear, items, and currency your character is carrying.',
  },
  {
    key: 'abilities',
    label: 'Abilities & Feats',
    audience: 'player',
    blurb: 'Your class/racial features and feats, with optional use tracking.',
  },
  {
    key: 'spells',
    label: 'Spells',
    audience: 'player',
    blurb: 'Your spells, organized by level, with a prepared toggle.',
  },
  {
    key: 'lore',
    label: 'Backstory',
    audience: 'player',
    blurb: "Your character's backstory, lore, and portrait.",
  },
  {
    key: 'hp',
    label: 'HP & conditions',
    audience: 'player',
    blurb: 'Track hit points, conditions, and death saves in the moment.',
  },
  {
    key: 'journal',
    label: 'Journal',
    audience: 'player',
    blurb: 'Your private, personal in-character journal.',
  },
  {
    key: 'shared',
    label: 'Shared with us',
    audience: 'player',
    blurb: 'Handouts and lore the DM has revealed to you or the party.',
  },
]

/**
 * Returns the tabs visible to a member given their role.
 * @param isDm - Whether the caller is a DM of this campaign.
 * @returns The subset of WORKSPACE_TABS this role should see, in catalog order.
 */
export function tabsForRole(isDm: boolean): WorkspaceTab[] {
  return WORKSPACE_TABS.filter((tab) => {
    if (tab.audience === 'all') return true
    return isDm ? tab.audience === 'dm' : tab.audience === 'player'
  })
}
