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
import { MapsPanel } from '../playspace/MapsPanel'
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
 * @param characterUserId - WHOSE character sheet the character-scoped panels
 *                        should show. Defaults to `currentUserId`, which is the
 *                        only value it ever takes outside a dev build. The dev
 *                        character switcher (9.1a) passes another member's id so
 *                        a DM can inspect a party member's sheet in place; RLS
 *                        already lets a DM READ every character in their
 *                        campaign, and still refuses every write, so the
 *                        inspected sheet is effectively read-only. Deliberately
 *                        NOT applied to Overview or Settings, whose use of
 *                        `currentUserId` is about the caller (schedule RSVPs,
 *                        the "(you)" marker) rather than about a character.
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
  characterUserId,
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
  characterUserId?: string
  onRenamed: (name: string) => void
  onModeChanged: (mode: GameMode) => void
  workspace: WorkspacePrefs
}) {
  const cid = campaign.id
  // The subject of the character-scoped panels. `?? currentUserId` is what makes
  // this a no-op everywhere except the dev switcher.
  const subjectId = characterUserId ?? currentUserId

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
  ) : tab.key === 'character' && subjectId ? (
    // `key` forces a remount when the subject changes: these panels load in an
    // effect and hold edit state, so reusing the instance would show one
    // character's draft over another's data.
    <CharacterPanel key={subjectId} campaignId={cid} currentUserId={subjectId} />
  ) : tab.key === 'inventory' && subjectId ? (
    // `key` forces a remount when the subject changes: these panels load in an
    // effect and hold edit state, so reusing the instance would show one
    // character's draft over another's data.
    <InventoryPanel key={subjectId} campaignId={cid} currentUserId={subjectId} />
  ) : tab.key === 'lore' && subjectId ? (
    // `key` forces a remount when the subject changes: these panels load in an
    // effect and hold edit state, so reusing the instance would show one
    // character's draft over another's data.
    <LorePanel key={subjectId} campaignId={cid} currentUserId={subjectId} />
  ) : tab.key === 'abilities' && subjectId ? (
    // `key` forces a remount when the subject changes: these panels load in an
    // effect and hold edit state, so reusing the instance would show one
    // character's draft over another's data.
    <AbilitiesPanel key={subjectId} campaignId={cid} currentUserId={subjectId} />
  ) : tab.key === 'spells' && subjectId ? (
    // `key` forces a remount when the subject changes: these panels load in an
    // effect and hold edit state, so reusing the instance would show one
    // character's draft over another's data.
    <SpellsPanel key={subjectId} campaignId={cid} currentUserId={subjectId} />
  ) : tab.key === 'journal' && subjectId ? (
    // `key` forces a remount when the subject changes: these panels load in an
    // effect and hold edit state, so reusing the instance would show one
    // character's draft over another's data.
    <JournalPanel key={subjectId} campaignId={cid} currentUserId={subjectId} />
  ) : tab.key === 'secretnotes' && isDm ? (
    <NotesPanel campaignId={cid} />
  ) : tab.key === 'sessionlog' && isDm ? (
    <SessionLogPanel campaignId={cid} />
  ) : tab.key === 'maps' && isDm ? (
    <MapsPanel campaignId={cid} isDm={isDm} />
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
  ) : tab.key === 'hp' && subjectId ? (
    // `key` forces a remount when the subject changes: these panels load in an
    // effect and hold edit state, so reusing the instance would show one
    // character's draft over another's data.
    <HpConditionsPanel key={subjectId} campaignId={cid} currentUserId={subjectId} />
  ) : (
    <PlaceholderPanel tab={tab} />
  )
}
