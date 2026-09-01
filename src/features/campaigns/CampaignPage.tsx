/**
 * CampaignPage — the role-aware campaign workspace shell ("/campaigns/:id"),
 * built in subphase 1.4.
 *
 * Owns: loading the campaign + roster + the caller's role, then handing them to
 * <WorkspaceShell>, which is the chrome in every game mode — a tab rail down one
 * edge and every open panel as a floating window. Tab bodies are delegated
 * wholesale to <TabBody>.
 *
 * This page keeps only what has to sit outside the shell: the app header (with
 * the campaign name in its centre slot) and the load/error states. As of 5.2.1c
 * it no longer renders a campaign title bar of its own — that row cost vertical
 * space a full-bleed workspace needs — and the in-workspace campaign switcher is
 * gone with it, so switching campaigns goes via the dashboard.
 *
 * This page also owns the canonical `campaign` row, so panels that mutate it
 * (rename, game-mode switch) report back via callbacks and the chrome updates
 * without a refetch.
 *
 * Role gating in the UI is defense-in-depth; RLS is the real access control.
 * The caller's role comes from listMyCampaigns, so a single membership read
 * drives both the header badge and tab gating.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppHeader } from '../../components/AppHeader'
import { FormError } from '../../components/ui'
import { LapseBanner } from '../billing/LapseBanner'
import { useDevAccess } from '../dev/useDevAccess'
import { OverviewPanel } from './OverviewPanel'
import { WorkspaceShell } from './WorkspaceShell'
import { tabsForRole } from './tabs'
import {
  getCampaign,
  listMembers,
  listMyCampaigns,
  type Campaign,
  type CampaignWithRole,
  type GameMode,
  type Member,
} from './api'

/**
 * The dev-only test toolbar, loaded ONLY in a dev build.
 *
 * A plain static import would put the component in the production bundle even
 * though it can never render there — verified: the first version of this leaked
 * "View as player" and its banner copy into dist/. `import.meta.env.DEV` is a
 * compile-time constant, so in a production build this whole expression folds to
 * `null`, the `import()` becomes unreachable, and Rollup drops the module.
 *
 * That is the difference between the control being HIDDEN and being ABSENT, and
 * it is the one the QA step actually checks for.
 */
const DevToolsBar = import.meta.env.DEV
  ? lazy(() =>
      import('../dev/DevToolsBar').then((m) => ({ default: m.DevToolsBar })),
    )
  : null

/** localStorage key holding the last-selected tab for a given campaign. */
function tabStorageKey(campaignId: string): string {
  return `campaign:${campaignId}:activeTab`
}

/** localStorage key holding which of the campaign's two views was last shown. */
function viewStorageKey(campaignId: string): string {
  return `campaign:${campaignId}:view`
}

export function CampaignPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  // Dashboard navigations carry `{ openOverview: true }`; a refresh or a pasted
  // URL does not. That is the whole distinction: Overview auto-opens when you
  // deliberately enter a campaign from the main menu, and stays out of the way
  // otherwise. It has no rail entry, so this is how it surfaces.
  const location = useLocation()
  const navigate = useNavigate()
  const cameFromDashboard = !!(location.state as { openOverview?: boolean } | null)?.openOverview

  // Which of the campaign's two views is showing. Overview is a full PAGE, not
  // a panel: it is read at full width, and it is where you land when you open a
  // campaign from the dashboard. Everything else lives in the workspace shell.
  //
  // Persisted per campaign so a REFRESH keeps you where you were. Arriving from
  // the dashboard always wins and forces Overview; otherwise the stored value
  // decides. Getting this wrong is bidirectional and both directions have been
  // seen: reading only the router state bounced every refresh back to Overview
  // (because history.state survives a reload), and then dropping it entirely
  // threw you into the workspace when you refreshed *on* the overview page.
  const [view, setView] = useState<'overview' | 'workspace'>(() => {
    if (cameFromDashboard || !id) return 'overview'
    try {
      return localStorage.getItem(viewStorageKey(id)) === 'overview' ? 'overview' : 'workspace'
    } catch {
      return 'workspace'
    }
  })

  // Persist the view per campaign. No loading guard needed: unlike activeTab,
  // this value is not role-dependent, so there is nothing for a late-arriving
  // role to invalidate.
  useEffect(() => {
    if (!id) return
    try {
      localStorage.setItem(viewStorageKey(id), view)
    } catch {
      /* ignore — view preference only */
    }
  }, [id, view])

  // Switching campaigns restores THAT campaign's last view.
  useEffect(() => {
    if (!id || cameFromDashboard) return
    try {
      setView(localStorage.getItem(viewStorageKey(id)) === 'overview' ? 'overview' : 'workspace')
    } catch {
      setView('workspace')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Consume the dashboard's navigation state immediately.
  //
  // `history.state` SURVIVES A PAGE RELOAD, so without this the flag stayed set
  // and every refresh bounced you back to Overview — which is exactly the bug
  // reported after the first run. Replacing the entry with a null state means
  // the flag is read once, on the navigation that actually carried it.
  useEffect(() => {
    if (cameFromDashboard) navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameFromDashboard])

  // Every campaign the caller belongs to, with their role in each. Read purely
  // for THIS campaign's role — the in-workspace campaign switcher was removed in
  // 5.2.1c, so switching now goes via the dashboard. The list is still the
  // cheapest way to learn the caller's role without a separate query.
  // Dev-only test tooling (9.1a): a dev build, allowlisted account only.
  const devAccess = useDevAccess()

  // "View as player" — a DM re-rendering their own campaign the way a player
  // sees it. Deliberately NOT persisted: it is a momentary inspection, and a
  // mode that survives a reload is one you forget you are in. Also reset when
  // the campaign changes, below.
  const [viewAsPlayer, setViewAsPlayer] = useState(false)

  // Dev-only (9.1a): whose character sheet the character-scoped panels show.
  // `undefined` means "mine", which is the only value outside a dev build.
  // Reset alongside viewAsPlayer when the campaign changes — a member id from
  // one campaign is meaningless in the next, and the panels would simply show
  // an empty sheet with no hint as to why.
  const [characterUserId, setCharacterUserId] = useState<string | undefined>(undefined)

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
  const realIsDm = myRole === 'dm'
  // What the UI renders as. Everything downstream — tabsForRole, TabBody, every
  // panel — already keys off `isDm`, so overriding it here is the whole feature;
  // no panel needs to know the mode exists.
  const isDm = realIsDm && !(devAccess && viewAsPlayer)
  // Only the owner (the creating DM) may delete; matches campaigns_delete_owner.
  // Owner-only controls follow the view override too: a DM inspecting the player
  // view should not still see the delete-campaign button.
  const isOwner = !!campaign && campaign.owner_id === user?.id && isDm

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

  // Leaving a campaign drops the player-view override. Carrying it into the next
  // campaign would mean opening one and quietly seeing less of it than you have
  // access to, with the cause two screens back. The inspected-sheet override
  // goes with it: a member id is scoped to one campaign's roster.
  useEffect(() => {
    setViewAsPlayer(false)
    setCharacterUserId(undefined)
  }, [id])

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

  /** Keeps the shell's campaign in sync after a rename, without a refetch. */
  const handleRenamed = useCallback((name: string) => {
    setCampaign((c) => (c ? { ...c, name } : c))
  }, [])

  /**
   * Same for a game-mode switch — and this one also swaps the chrome, since the
   * branch below reads `campaign.game_mode`. Switching modes in Settings
   * therefore re-frames the workspace immediately.
   */
  const handleModeChanged = useCallback((mode: GameMode) => {
    setCampaign((c) => (c ? { ...c, game_mode: mode } : c))
  }, [])

  return (
    // Full-bleed app frame: the workspace fills the viewport instead of sitting
    // in a centred reading column, because a battlemap and a wall of open panels
    // both want the whole window. `100dvh` rather than `vh` so mobile browser
    // chrome collapsing doesn't leave the shell overflowing or short.
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      {/* The campaign name rides in the app header's centre slot. It used to have
          its own bar below this one, which cost a full row of vertical space in
          a full-bleed workspace for one line of text. */}
      <AppHeader
        leading={
          campaign ? (
            <button
              type="button"
              onClick={() => setView((v) => (v === 'overview' ? 'workspace' : 'overview'))}
              title={
                view === 'overview'
                  ? 'Back to the campaign workspace'
                  : 'Roster, invite codes and session scheduling'
              }
              style={{
                font: 'inherit',
                fontSize: '0.9rem',
                cursor: 'pointer',
                background: view === 'overview' ? 'var(--color-bg)' : 'none',
                border: `1px solid ${view === 'overview' ? 'var(--color-accent)' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius)',
                color: view === 'overview' ? 'var(--color-text)' : 'var(--color-text-muted)',
                padding: 'var(--space-2) var(--space-3)',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {view === 'overview' ? '← Workspace' : 'Campaign overview'}
            </button>
          ) : undefined
        }
        center={
          campaign ? (
            <>
              <strong style={{ fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {campaign.name}
              </strong>
              {myRole && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: isDm ? 'var(--color-accent)' : 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: '2px 8px',
                    flexShrink: 0,
                  }}
                >
                  {isDm ? 'DM' : 'Player'}
                </span>
              )}
            </>
          ) : undefined
        }
      />
      {/* Deletion countdown, above BOTH views and outside the scroll area —
          a notice that your campaign is about to be destroyed must not be
          something you can scroll a panel past. Renders nothing unless the
          campaign is actually read-only. */}
      {campaign && <LapseBanner campaignId={campaign.id} />}
      {/* Dev-only (9.1a). Renders nothing outside a dev build on an allowlisted
          account, and is absent from production bundles entirely. */}
      {devAccess && DevToolsBar && campaign && (
        <Suspense fallback={null}>
          <DevToolsBar
            isDm={realIsDm}
            viewAsPlayer={viewAsPlayer}
            onToggleViewAsPlayer={setViewAsPlayer}
            currentUserId={user?.id}
            username={members.find((m) => m.userId === user?.id)?.username}
            members={members}
            characterUserId={characterUserId}
            onChangeCharacterUserId={setCharacterUserId}
          />
        </Suspense>
      )}
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', padding: 'var(--space-8)' }}>Loading…</p>
        ) : error && !campaign ? (
          <div style={{ padding: 'var(--space-8)' }}>
            <FormError message={error} />
          </div>
        ) : campaign ? (
          <>
            {/* Campaign overview — a full page, read at full width, not a
                panel you arrange. This is the landing view when you open a
                campaign from the dashboard. */}
            {view === 'overview' ? (
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <div style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--space-8)' }}>
                  <OverviewPanel
                    campaign={campaign}
                    members={members}
                    isDm={isDm}
                    currentUserId={user?.id}
                    onEnterWorkspace={() => setView('workspace')}
                  />
                </div>
              </div>
            ) : (
            /* The one workspace chrome, for every game mode. */
            <WorkspaceShell
              campaign={campaign}
              visibleTabs={visibleTabs}
              onActiveTabChange={setActiveTab}
              members={members}
              isDm={isDm}
              isOwner={isOwner}
              currentUserId={user?.id}
              // Gated on devAccess as well as the state, so that even if the
              // state were somehow set it could not redirect a real session's
              // panels at another member.
              characterUserId={devAccess ? characterUserId : undefined}
              onRenamed={handleRenamed}
              onModeChanged={handleModeChanged}
            />
            )}
          </>
        ) : null}
      </main>
    </div>
  )
}
