/**
 * CampaignPage — the role-aware campaign workspace shell ("/campaigns/:id"),
 * built in subphase 1.4.
 *
 * Owns: loading the campaign + roster + the caller's role, then rendering the
 * workspace chrome around it — a campaign switcher, a DM/player indicator, and
 * a role-filtered tab bar. Tab bodies are delegated: the "Overview" tab renders
 * <OverviewPanel> (roster, DM invite codes, owner danger zone); every other tab
 * renders a <PlaceholderPanel> until its real content ships in a later phase.
 *
 * Role gating in the UI is defense-in-depth; RLS is the real access control.
 * The caller's role comes from listMyCampaigns (which the switcher also uses),
 * so a single membership read drives both the switcher and tab gating.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppHeader } from '../../components/AppHeader'
import { FormError } from '../../components/ui'
import { OverviewPanel } from './OverviewPanel'
import { PlaceholderPanel } from './PlaceholderPanel'
import { BillingPanel } from '../billing/BillingPanel'
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
import { SchedulePanel } from '../schedule/SchedulePanel'
import { tabsForRole } from './tabs'
import {
  getCampaign,
  listMembers,
  listMyCampaigns,
  type Campaign,
  type CampaignWithRole,
  type Member,
} from './api'

/** localStorage key holding the last-selected tab for a given campaign. */
function tabStorageKey(campaignId: string): string {
  return `campaign:${campaignId}:activeTab`
}

export function CampaignPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  // Every campaign the caller belongs to, with their role in each. Drives both
  // the switcher and this campaign's role (no separate role query needed).
  const [myCampaigns, setMyCampaigns] = useState<CampaignWithRole[]>([])
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The key of the currently selected tab. Persisted PER CAMPAIGN in
  // localStorage so a refresh (or coming back later) lands on the same tab
  // instead of resetting to Overview. Lazily initialized from storage.
  const [activeTab, setActiveTab] = useState(() =>
    id ? localStorage.getItem(tabStorageKey(id)) ?? 'overview' : 'overview',
  )

  // The caller's role in THIS campaign. Prefer the membership list; fall back to
  // the roster (both are RLS-scoped to the caller anyway).
  const myRole =
    myCampaigns.find((c) => c.campaign.id === id)?.role ??
    members.find((m) => m.userId === user?.id)?.role ??
    null
  const isDm = myRole === 'dm'
  // Only the owner (the creating DM) may delete; matches campaigns_delete_owner.
  const isOwner = !!campaign && campaign.owner_id === user?.id

  // The tabs this role can see. Memoized so the tab bar and the "is the active
  // tab still valid?" guard below agree on the same list.
  const visibleTabs = useMemo(() => tabsForRole(isDm), [isDm])

  /** Loads the campaign, roster, and the caller's membership list. */
  const refresh = useCallback(async () => {
    if (!id || !user) return
    setLoading(true)
    setError(null)
    try {
      const [c, m, mine] = await Promise.all([
        getCampaign(id),
        listMembers(id),
        listMyCampaigns(user.id),
      ])
      setCampaign(c)
      setMembers(m)
      setMyCampaigns(mine)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign.')
    } finally {
      setLoading(false)
    }
  }, [id, user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // When the campaign changes, restore THAT campaign's last-selected tab (or
  // Overview if it has none saved), so each campaign remembers its own tab.
  useEffect(() => {
    if (!id) return
    setActiveTab(localStorage.getItem(tabStorageKey(id)) ?? 'overview')
  }, [id])

  // Persist the active tab for this campaign whenever it changes — but NOT while
  // the campaign is still loading. During load `myRole` isn't known yet, so a
  // restored DM tab would look "invalid" to the guard below; persisting then
  // would clobber the saved value with 'overview'. Waiting for load avoids that.
  useEffect(() => {
    if (id && !loading) localStorage.setItem(tabStorageKey(id), activeTab)
  }, [id, activeTab, loading])

  // If the caller's role changes such that the active tab is no longer visible
  // (e.g. a player-only tab while viewing as DM), fall back to Overview. Gated on
  // `!loading` so it doesn't fire before the role is known and bounce a valid
  // (e.g. DM-only) restored tab back to Overview on every refresh.
  useEffect(() => {
    if (loading) return
    if (!visibleTabs.some((t) => t.key === activeTab)) setActiveTab('overview')
  }, [visibleTabs, activeTab, loading])

  /** Campaign switcher: navigate to the chosen campaign's workspace. */
  function handleSwitch(nextId: string) {
    if (nextId && nextId !== id) navigate(`/campaigns/${nextId}`)
  }

  const activeTabDef = visibleTabs.find((t) => t.key === activeTab)

  return (
    <>
      <AppHeader />
      <main style={{ maxWidth: 860, margin: '0 auto', padding: 'var(--space-8)' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
        ) : error && !campaign ? (
          <FormError message={error} />
        ) : campaign ? (
          <>
            {/* Workspace header: name, role badge, and the campaign switcher. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                flexWrap: 'wrap',
              }}
            >
              <h1 style={{ margin: 0 }}>{campaign.name}</h1>
              {myRole && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: isDm ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: '2px 8px',
                  }}
                >
                  {isDm ? 'You are the DM' : 'You are a player'}
                </span>
              )}

              {/* Campaign switcher — only shown when the user has more than one. */}
              {myCampaigns.length > 1 && (
                <label style={{ marginLeft: 'auto', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--color-text-muted)', marginRight: 'var(--space-2)' }}>
                    Switch to
                  </span>
                  <select
                    value={id}
                    onChange={(e) => handleSwitch(e.target.value)}
                    style={{
                      font: 'inherit',
                      padding: 'var(--space-2) var(--space-3)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-text)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    {myCampaigns.map(({ campaign: c, role }) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({role === 'dm' ? 'DM' : 'Player'})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {/* Role-aware tab bar. */}
            <nav
              role="tablist"
              aria-label="Campaign sections"
              style={{
                display: 'flex',
                gap: 'var(--space-1)',
                flexWrap: 'wrap',
                marginTop: 'var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              {visibleTabs.map((tab) => {
                const selected = tab.key === activeTab
                return (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveTab(tab.key)}
                    style={{
                      font: 'inherit',
                      fontSize: '1.15rem',
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      padding: 'var(--space-3) var(--space-4)',
                      color: selected ? 'var(--color-text)' : 'var(--color-text-muted)',
                      fontWeight: selected ? 600 : 400,
                      borderBottom: selected
                        ? '2px solid var(--color-accent)'
                        : '2px solid transparent',
                      marginBottom: '-1px',
                    }}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </nav>

            {/* Active tab body. */}
            {activeTabDef?.key === 'overview' ? (
              <OverviewPanel
                campaign={campaign}
                members={members}
                isDm={isDm}
                isOwner={isOwner}
                currentUserId={user?.id}
                onRenamed={(name) => setCampaign((c) => (c ? { ...c, name } : c))}
              />
            ) : activeTabDef?.key === 'billing' ? (
              <BillingPanel campaignId={campaign.id} />
            ) : activeTabDef?.key === 'character' && user ? (
              <CharacterPanel campaignId={campaign.id} currentUserId={user.id} />
            ) : activeTabDef?.key === 'inventory' && user ? (
              <InventoryPanel campaignId={campaign.id} currentUserId={user.id} />
            ) : activeTabDef?.key === 'lore' && user ? (
              <LorePanel campaignId={campaign.id} currentUserId={user.id} />
            ) : activeTabDef?.key === 'abilities' && user ? (
              <AbilitiesPanel campaignId={campaign.id} currentUserId={user.id} />
            ) : activeTabDef?.key === 'spells' && user ? (
              <SpellsPanel campaignId={campaign.id} currentUserId={user.id} />
            ) : activeTabDef?.key === 'journal' && user ? (
              <JournalPanel campaignId={campaign.id} currentUserId={user.id} />
            ) : activeTabDef?.key === 'secretnotes' && isDm ? (
              <NotesPanel campaignId={campaign.id} />
            ) : activeTabDef?.key === 'sessionlog' && isDm ? (
              <SessionLogPanel campaignId={campaign.id} />
            ) : activeTabDef?.key === 'party' && isDm ? (
              <PartyPanel campaignId={campaign.id} />
            ) : activeTabDef?.key === 'npcs' && isDm ? (
              <NpcsPanel campaignId={campaign.id} />
            ) : activeTabDef?.key === 'encounters' && isDm ? (
              <EncountersPanel campaignId={campaign.id} />
            ) : activeTabDef?.key === 'quests' && isDm ? (
              <QuestsPanel campaignId={campaign.id} />
            ) : activeTabDef?.key === 'combat' && isDm ? (
              <CombatPanel campaignId={campaign.id} />
            ) : activeTabDef?.key === 'handouts' && isDm ? (
              <HandoutsPanel campaignId={campaign.id} />
            ) : activeTabDef?.key === 'shared' && !isDm ? (
              <SharedWithUsPanel campaignId={campaign.id} />
            ) : activeTabDef?.key === 'schedule' && user ? (
              <SchedulePanel campaignId={campaign.id} currentUserId={user.id} isDm={isDm} />
            ) : activeTabDef?.key === 'hp' && user ? (
              <HpConditionsPanel campaignId={campaign.id} currentUserId={user.id} />
            ) : activeTabDef ? (
              <PlaceholderPanel tab={activeTabDef} />
            ) : null}
          </>
        ) : null}
      </main>
    </>
  )
}
