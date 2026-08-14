/**
 * TabBody — renders the panel body for one workspace tab.
 *
 * Extracted from CampaignPage in Phase 5.2. Until then the shell held a single
 * long `activeTabDef?.key === …` chain inline, which was fine while there was
 * exactly one chrome. 5.2 adds a second: `playspace`/`rpg` campaigns render a
 * sidebar whose panels can be docked in a drawer OR floating in several detached
 * windows at once — so the same tab body has to be renderable from three places.
 * Keeping the chain here means the mode-aware chrome never duplicates it and the
 * two shells can never drift on which panel a tab maps to.
 *
 * This component decides only WHAT to render, never WHERE — its callers own the
 * frame. It re-asserts the role guards (`isDm` / `currentUserId`) that the chain
 * always carried; they are defense-in-depth, as RLS is the real access control.
 */
import { OverviewPanel } from './OverviewPanel'
import { SettingsPanel, type WorkspacePrefs } from './SettingsPanel'
import { PlaceholderPanel } from './PlaceholderPanel'
import { CharacterPanel } from '../character/CharacterPanel'
import { InventoryPanel } from '../inventory/InventoryPanel'
import { LorePanel } from '../lore/LorePanel'
import { JournalPanel } from '../journal/JournalPanel'
import { AbilitiesPanel } from '../abilities/AbilitiesPanel'
import { SpellsPanel } from '../spells/SpellsPanel'
import { NotesPanel } from '../dm/NotesPanel'
import { SessionLogPanel } from '../dm/SessionLogPanel'
import { PartyPanel } from '../party/PartyPanel'
import { NpcsPanel } from '../dm/NpcsPanel'
import { EncountersPanel } from '../dm/EncountersPanel'
import { QuestsPanel } from '../dm/QuestsPanel'
import { CombatPanel } from '../dm/CombatPanel'
import { HandoutsPanel, SharedWithUsPanel } from '../shared/SharedPanel'
import { HpConditionsPanel } from '../status/HpConditionsPanel'
import type { WorkspaceTab } from './tabs'
import type { Campaign, GameMode, Member } from './api'

/**
 * @param tab - The tab whose body to render (already filtered by role).
 * @param campaign - The shell's canonical campaign row.
 * @param members - The roster, for Overview.
 * @param isDm - Whether the caller is this campaign's DM.
 * @param isOwner - Whether the caller owns it (gates Settings' danger zone).
 * @param currentUserId - The signed-in user's id; panels keyed to "my" data need
 *                        it, and its absence suppresses those panels entirely.
 * @param onRenamed - Called with the new name after a successful rename, so the
 *                    shell's copy of the campaign updates without a refetch.
 * @param onModeChanged - Same, for a game-mode switch. This is what makes the
 *                        chrome swap immediately.
 * @param workspace - Layout preference controls, forwarded to Settings. The
 *                    shell owns the layout, so these are its callbacks.
 */
export function TabBody({
  tab,
  campaign,
  members,
  isDm,
  isOwner,
  currentUserId,
  onRenamed,
  onModeChanged,
  workspace,
}: {
  tab: WorkspaceTab
  campaign: Campaign
  members: Member[]
  isDm: boolean
  isOwner: boolean
  currentUserId?: string
  onRenamed: (name: string) => void
  onModeChanged: (mode: GameMode) => void
  workspace: WorkspacePrefs
}) {
  const cid = campaign.id

  return tab.key === 'overview' ? (
    <OverviewPanel campaign={campaign} members={members} isDm={isDm} currentUserId={currentUserId} />
  ) : tab.key === 'settings' ? (
    // Not gated on isDm: everyone gets the Workspace section. SettingsPanel
    // itself withholds the campaign-administration half from players.
    <SettingsPanel
      campaign={campaign}
      isDm={isDm}
      workspace={workspace}
      isOwner={isOwner}
      onRenamed={onRenamed}
      onModeChanged={onModeChanged}
    />
  ) : tab.key === 'character' && currentUserId ? (
    <CharacterPanel campaignId={cid} currentUserId={currentUserId} />
  ) : tab.key === 'inventory' && currentUserId ? (
    <InventoryPanel campaignId={cid} currentUserId={currentUserId} />
  ) : tab.key === 'lore' && currentUserId ? (
    <LorePanel campaignId={cid} currentUserId={currentUserId} />
  ) : tab.key === 'abilities' && currentUserId ? (
    <AbilitiesPanel campaignId={cid} currentUserId={currentUserId} />
  ) : tab.key === 'spells' && currentUserId ? (
    <SpellsPanel campaignId={cid} currentUserId={currentUserId} />
  ) : tab.key === 'journal' && currentUserId ? (
    <JournalPanel campaignId={cid} currentUserId={currentUserId} />
  ) : tab.key === 'secretnotes' && isDm ? (
    <NotesPanel campaignId={cid} />
  ) : tab.key === 'sessionlog' && isDm ? (
    <SessionLogPanel campaignId={cid} />
  ) : tab.key === 'party' && isDm ? (
    <PartyPanel campaignId={cid} />
  ) : tab.key === 'npcs' && isDm ? (
    <NpcsPanel campaignId={cid} />
  ) : tab.key === 'encounters' && isDm ? (
    <EncountersPanel campaignId={cid} />
  ) : tab.key === 'quests' && isDm ? (
    <QuestsPanel campaignId={cid} />
  ) : tab.key === 'combat' && isDm ? (
    <CombatPanel campaignId={cid} />
  ) : tab.key === 'handouts' && isDm ? (
    <HandoutsPanel campaignId={cid} />
  ) : tab.key === 'shared' && !isDm ? (
    <SharedWithUsPanel campaignId={cid} />
  ) : tab.key === 'hp' && currentUserId ? (
    <HpConditionsPanel campaignId={cid} currentUserId={currentUserId} />
  ) : (
    <PlaceholderPanel tab={tab} />
  )
}
