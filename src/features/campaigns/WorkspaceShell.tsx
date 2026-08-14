/**
 * WorkspaceShell — the campaign workspace chrome, for **every** game mode
 * (Phase 5.2).
 *
 * A tab rail down one edge, and every open panel as a floating window in the
 * area beside it. The rail can sit on the left or the right (right by default),
 * be dragged wider or narrower by its inner edge (double-click to reset), and be
 * collapsed to a strip. The whole thing is full-bleed, filling the
 * viewport below the app header.
 *
 * **Clicking a rail entry opens that panel as a floating window immediately**
 * (5.2.1c). There is no docked panel and no separate pop-out step — the earlier
 * "click the tab, then click ⧉" was two actions for what is one intent. Clicking
 * an entry that is already open focuses its window; clicking it while focused
 * closes it, so a rail entry is a plain toggle.
 *
 * Consequences worth knowing:
 *   - "Open" is simply presence in `layout.floating`. There is no other state a
 *     panel can be in, which is what makes the old "docked **or** floating,
 *     never both" invariant unnecessary rather than merely satisfied.
 *   - Panels always render at floating-window size, so none of them get the full
 *     width they had under the old tab bar. Windows are resizable from any edge
 *     for exactly this reason.
 *
 * `game_mode` decides only what fills the area behind the windows: nothing (a
 * hint) in `notetaker`, or the shared battlemap in `playspace`/`rpg` — a
 * placeholder until Phase 9.
 *
 * Layout is a per-user view preference persisted to localStorage (see layout.ts)
 * — never campaign data, never synced between users. Role gating is unchanged
 * from the old tab bar: the rail renders the same `tabsForRole` list, and RLS
 * remains the real access control.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FloatingPanel } from './FloatingPanel'
import { TabBody } from './TabBody'
import {
  clampRailWidth,
  clampRect,
  DEFAULT_FLOAT,
  DEFAULT_LAYOUT,
  DEFAULT_RAIL_W,
  loadLayout,
  sameRect,
  saveLayout,
  type CampaignLayout,
  type FloatRect,
} from './layout'
import { railFooterTabs, railTabs, type WorkspaceTab } from './tabs'
import type { Campaign, GameMode, Member } from './api'

/** Rail width when collapsed. Expanded width is user-dragged; see layout.ts. */
const RAIL_COLLAPSED_W = 44

/**
 * @param campaign - The shell's canonical campaign row; its `game_mode` decides
 *                   what fills the area behind the windows.
 * @param visibleTabs - Role-filtered tab list; the rail renders exactly this.
 * @param onActiveTabChange - Records the most recently opened tab. Which panels
 *                    are open is restored from the saved layout, not from this,
 *                    so it exists only to keep the page's own `activeTab`
 *                    persistence meaningful.
 * @param members - Roster, forwarded to Overview.
 * @param isDm / isOwner / currentUserId - Forwarded to TabBody's role guards.
 * @param onRenamed / onModeChanged - Forwarded so panel edits update the page.
 * @param openRequest - An outside request to open a panel: `{ key, nonce }`.
 *        The shell opens (or raises) that panel whenever `nonce` changes, which
 *        is how a control OUTSIDE the shell drives it — the header's "Campaign
 *        overview" button, and the initial open when you arrive from the
 *        dashboard. A nonce rather than a boolean because the same request can
 *        legitimately repeat: clicking the header button twice should raise the
 *        window twice, and a bare flag couldn't express the second click.
 */
export function WorkspaceShell({
  campaign,
  visibleTabs,
  onActiveTabChange,
  members,
  isDm,
  isOwner,
  currentUserId,
  onRenamed,
  onModeChanged,
  openRequest,
}: {
  campaign: Campaign
  visibleTabs: WorkspaceTab[]
  onActiveTabChange: (key: string) => void
  members: Member[]
  isDm: boolean
  isOwner: boolean
  currentUserId?: string
  onRenamed: (name: string) => void
  onModeChanged: (mode: GameMode) => void
  openRequest?: { key: string; nonce: number }
}) {
  /** Does this mode reserve the area for a map? */
  const hasPlayspace = campaign.game_mode !== 'notetaker'

  // Lazily restored from storage, already filtered to tabs this role can see.
  const [layout, setLayout] = useState<CampaignLayout>(() => loadLayout(campaign.id, visibleTabs))

  // The workspace area's pixel size, so floating windows can be clamped to it.
  const areaRef = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState({ w: 0, h: 0 })

  // Re-read the layout when the campaign changes: this component is reused
  // across a switcher navigation, and each campaign has its own arrangement.
  useEffect(() => {
    setLayout(loadLayout(campaign.id, visibleTabs))
    // `visibleTabs` is intentionally not a dependency — it is a fresh array on
    // every render of the parent, so including it would reload (and thereby
    // reset) the layout constantly. Role changes are handled by the pruning
    // effect below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id])

  // Drop windows for tabs this caller can no longer see. Covers a role change
  // mid-session, and a tab leaving the catalog entirely (as 'billing' did in
  // 5.2.1b); loadLayout covers the same cases at restore time.
  useEffect(() => {
    const allowed = new Set(visibleTabs.map((t) => t.key))
    setLayout((l) =>
      l.floating.every((p) => allowed.has(p.key))
        ? l
        : { ...l, floating: l.floating.filter((p) => allowed.has(p.key)) },
    )
  }, [visibleTabs])

  // Pull any window that sits outside the workspace area back into view.
  //
  // This runs whenever the area is measured or resized, which covers the two
  // ways a window ends up unreachable: restoring a layout saved on a larger
  // viewport, and shrinking the browser window under windows already open. The
  // area is `overflow: hidden`, so an out-of-bounds window is invisible with no
  // scrollbar to chase it — correcting the STATE (rather than just the rendered
  // position) means the fix is persisted and the window stays recovered.
  //
  // Guarded on an actual change so it can't loop: clampRect is idempotent, so
  // once every rect fits, this bails before touching state.
  useEffect(() => {
    if (!bounds.w || !bounds.h) return
    setLayout((l) => {
      const floating = l.floating.map((p) => ({ ...p, ...clampRect(p, bounds) }))
      return floating.every((p, i) => sameRect(p, l.floating[i])) ? l : { ...l, floating }
    })
  }, [bounds])

  // Honour open requests from outside the shell (the header's "Campaign
  // overview" button; the initial open when arriving from the dashboard).
  //
  // Keyed on the nonce only, so it fires once per request and never re-opens a
  // panel the user has since closed. Already open → raise it rather than
  // duplicating, which keeps the one-window-per-section invariant.
  const lastRequest = useRef<number | null>(null)
  useEffect(() => {
    if (!openRequest) return
    if (lastRequest.current === openRequest.nonce) return
    lastRequest.current = openRequest.nonce
    const { key } = openRequest
    if (!visibleTabs.some((t) => t.key === key)) return
    setLayout((l) => {
      const existing = l.floating.find((p) => p.key === key)
      if (existing) {
        // Raise, don't duplicate.
        return { ...l, floating: [...l.floating.filter((p) => p.key !== key), existing] }
      }
      return { ...l, floating: [...l.floating, { key, ...clampRect(DEFAULT_FLOAT, bounds) }] }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce])

  // Persist on every change. Cheap: FloatingPanel commits a rect once per drag,
  // not once per pointermove, so this fires on discrete user actions only.
  useEffect(() => {
    saveLayout(campaign.id, layout)
  }, [campaign.id, layout])

  // Track the workspace area's size for drag clamping. useLayoutEffect so the
  // first measurement lands before floating panels paint at a stale clamp.
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const update = () => setBounds({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const openKeys = new Set(layout.floating.map((p) => p.key))
  /** The frontmost window's key, or undefined when nothing is open. */
  const frontKey = layout.floating[layout.floating.length - 1]?.key

  /**
   * Opens a panel as a floating window, cascading it clear of the ones already
   * open so a fresh window is never hidden exactly behind an old one.
   */
  function open(key: string) {
    onActiveTabChange(key)
    setLayout((l) => {
      if (l.floating.some((p) => p.key === key)) return l
      const offset = (l.floating.length % 6) * 28
      // Clamp the opening position too: on a small viewport the cascade offset
      // alone could place a new window past the edge.
      const rect = clampRect(
        { ...DEFAULT_FLOAT, x: DEFAULT_FLOAT.x + offset, y: DEFAULT_FLOAT.y + offset },
        bounds,
      )
      return { ...l, floating: [...l.floating, { key, ...rect }] }
    })
  }

  /**
   * Rail click — a toggle in three steps, so one control covers open / raise /
   * close without a second button: closed → open; open but behind something →
   * bring to front; already frontmost → close. Raising before closing matters,
   * or clicking a half-buried window's rail entry to see it would dismiss it.
   */
  function handleRailClick(key: string) {
    if (!openKeys.has(key)) {
      open(key)
    } else if (frontKey !== key) {
      focusPanel(key)
    } else {
      closePanel(key)
    }
  }

  /** Closes one window. */
  function closePanel(key: string) {
    setLayout((l) => ({ ...l, floating: l.floating.filter((p) => p.key !== key) }))
  }

  /** Moves a panel to the end of the array, i.e. to the front of the stack. */
  function focusPanel(key: string) {
    setLayout((l) => {
      const panel = l.floating.find((p) => p.key === key)
      if (!panel || l.floating[l.floating.length - 1]?.key === key) return l
      return { ...l, floating: [...l.floating.filter((p) => p.key !== key), panel] }
    })
  }

  /**
   * "Close tabs" — closes every open window at once, leaving just the rail (and,
   * in playspace modes, an unobstructed map).
   *
   * Available to players and DMs alike: layout is a personal view preference, so
   * there is nothing role-specific to gate. It deliberately leaves
   * `sidebarCollapsed` and `railSide` alone (the rail is how you reopen
   * anything, so closing the tabs must never also hide or move the way back)
   * and does not change `activeTab`.
   *
   * No confirm step: nothing is deleted, every panel is one click from
   * returning, and a confirm on a tidy-up action is friction for no benefit.
   */
  function closeAllTabs() {
    setLayout((l) => ({ ...l, floating: [] }))
  }

  /**
   * Restores the default arrangement: everything closed, rail back to its
   * default side and width, expanded. Offered in Settings rather than the rail
   * because it is a bigger hammer than Close tabs and is not something you
   * reach for mid-session.
   */
  function resetLayout() {
    setLayout({ ...DEFAULT_LAYOUT })
  }

  /** Stores a window's new position/size (called once per drag, on release). */
  function setPanelRect(key: string, rect: FloatRect) {
    setLayout((l) => ({
      ...l,
      floating: l.floating.map((p) => (p.key === key ? { ...p, ...rect } : p)),
    }))
  }

  const openCount = layout.floating.length
  const onRight = layout.railSide === 'right'

  // Width previewed while dragging the rail's edge; null when idle so the saved
  // width wins. Same pattern as FloatingPanel: commit once on release rather
  // than writing localStorage on every pointermove.
  const railDrag = useRef<{ startX: number; startW: number } | null>(null)
  const [liveRailW, setLiveRailW] = useState<number | null>(null)
  const railWidth = layout.sidebarCollapsed
    ? RAIL_COLLAPSED_W
    : (liveRailW ?? layout.railWidth)

  /** Begins a rail resize, capturing the pointer to the grab strip. */
  function beginRailResize(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    railDrag.current = { startX: e.clientX, startW: railWidth }
    setLiveRailW(railWidth)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  /**
   * Previews the new rail width. The sign flips with the rail's side: dragging
   * left grows a right-hand rail but shrinks a left-hand one, so the delta is
   * negated when the rail is on the right.
   */
  function moveRailResize(e: React.PointerEvent) {
    const d = railDrag.current
    if (!d) return
    const dx = e.clientX - d.startX
    setLiveRailW(clampRailWidth(d.startW + (onRight ? -dx : dx)))
  }

  /** Commits the previewed rail width. */
  function endRailResize() {
    if (!railDrag.current) return
    railDrag.current = null
    if (liveRailW !== null) setLayout((l) => ({ ...l, railWidth: liveRailW }))
    setLiveRailW(null)
  }

  /**
   * Renders one footer entry (Overview, Settings). Same toggle behavior as a
   * section entry, but with a top border so the footer group reads as separate
   * from the section list above it.
   *
   * @param tab - The footer tab to draw.
   */
  function renderFooterTab(tab: WorkspaceTab) {
    const isOpen = openKeys.has(tab.key)
    return (
      <button
        key={tab.key}
        role="tab"
        aria-selected={isOpen}
        onClick={() => handleRailClick(tab.key)}
        title={layout.sidebarCollapsed ? tab.label : tab.blurb}
        style={{
          font: 'inherit',
          fontSize: '0.9rem',
          cursor: 'pointer',
          background: isOpen ? 'var(--color-bg)' : 'none',
          border: 'none',
          borderTop: '1px solid var(--color-border)',
          borderRight:
            !onRight ? undefined : isOpen ? '3px solid var(--color-accent)' : '3px solid transparent',
          borderLeft:
            onRight ? undefined : isOpen ? '3px solid var(--color-accent)' : '3px solid transparent',
          color: isOpen ? 'var(--color-text)' : 'var(--color-text-muted)',
          fontWeight: isOpen ? 600 : 400,
          padding: 'var(--space-3)',
          textAlign: 'left',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flexShrink: 0,
        }}
      >
        {layout.sidebarCollapsed ? tab.label.charAt(0) : tab.label}
      </button>
    )
  }

  const rail = (
    <nav
      role="tablist"
      aria-label="Campaign sections"
      aria-orientation="vertical"
      style={{
        width: railWidth,
        flexShrink: 0,
        // The grab strip is positioned against this edge.
        position: 'relative',
        // The divider always faces the workspace, so it moves with the rail.
        borderRight: onRight ? undefined : '1px solid var(--color-border)',
        borderLeft: onRight ? '1px solid var(--color-border)' : undefined,
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* Collapse toggle. The rail-side switch used to live beside it; since
          5.2.1f it is in Settings → Workspace, for both roles. */}
      <button
        type="button"
        aria-expanded={!layout.sidebarCollapsed}
        aria-label={layout.sidebarCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
        title={layout.sidebarCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
        onClick={() => setLayout((l) => ({ ...l, sidebarCollapsed: !l.sidebarCollapsed }))}
        style={{ ...railControl, borderBottom: '1px solid var(--color-border)' }}
      >
        {layout.sidebarCollapsed ? (onRight ? '«' : '»') : onRight ? '» Collapse' : '« Collapse'}
      </button>

      {/* Resize grab strip, on whichever edge faces the workspace. Hidden while
          collapsed — there the width is fixed and dragging it would be a way to
          get stuck at an unreadable size. */}
      {!layout.sidebarCollapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sidebar"
          title="Drag to resize the sidebar"
          onPointerDown={beginRailResize}
          onPointerMove={moveRailResize}
          onPointerUp={endRailResize}
          onPointerCancel={endRailResize}
          onDoubleClick={() => setLayout((l) => ({ ...l, railWidth: DEFAULT_RAIL_W }))}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            [onRight ? 'left' : 'right']: -3,
            width: 7,
            cursor: 'ew-resize',
            touchAction: 'none',
            // Invisible until hovered; the cursor is the affordance.
            background: 'transparent',
            zIndex: 1,
          }}
        />
      )}

      {railTabs(visibleTabs).map((tab) => {
        const isOpen = openKeys.has(tab.key)
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isOpen}
            onClick={() => handleRailClick(tab.key)}
            // Collapsed, the label is clipped away, so the tooltip carries it.
            title={layout.sidebarCollapsed ? tab.label : tab.blurb}
            style={{
              font: 'inherit',
              fontSize: '0.9rem',
              cursor: 'pointer',
              background: isOpen ? 'var(--color-bg)' : 'none',
              border: 'none',
              // The accent marker faces the workspace, like the divider.
              borderRight: !onRight
                ? undefined
                : isOpen
                  ? '3px solid var(--color-accent)'
                  : '3px solid transparent',
              borderLeft: onRight
                ? undefined
                : isOpen
                  ? '3px solid var(--color-accent)'
                  : '3px solid transparent',
              color: isOpen ? 'var(--color-text)' : 'var(--color-text-muted)',
              fontWeight: isOpen ? 600 : 400,
              padding: 'var(--space-3)',
              textAlign: 'left',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flexShrink: 0,
            }}
          >
            {layout.sidebarCollapsed ? tab.label.charAt(0) : tab.label}
          </button>
        )
      })}

      {/* Spacer: pushes the footer group to the bottom of the rail however few
          sections the role has. */}
      <div style={{ flex: 1, minHeight: 'var(--space-4)' }} />

      {/* ---- Footer group, pinned to the bottom ----
          Close tabs, then Settings under its own divider. (Overview is not here
          — it lives in the app header, beside the home link.) */}

      <button
        type="button"
        // Always rendered, even with nothing open — the user asked for a fixed
        // position they can rely on rather than a control that comes and goes.
        // Disabled instead of hidden when there is nothing to clear, so it never
        // silently does nothing.
        disabled={openCount === 0}
        aria-label={
          openCount === 0
            ? 'Close tabs — nothing is open'
            : `Close tabs — close ${openCount} open ${openCount === 1 ? 'panel' : 'panels'}`
        }
        title={openCount === 0 ? 'Nothing is open' : `Close all open panels (${openCount})`}
        onClick={closeAllTabs}
        style={{
          ...railControl,
          borderTop: '1px solid var(--color-border)',
          color: 'var(--color-danger)',
          // Dimmed rather than recoloured when disabled, so it still reads as
          // the same (destructive-looking) control.
          opacity: openCount === 0 ? 0.4 : 1,
          cursor: openCount === 0 ? 'default' : 'pointer',
        }}
      >
        {layout.sidebarCollapsed ? '⊘' : `⊘ Close tabs${openCount ? ` (${openCount})` : ''}`}
      </button>

      {railFooterTabs(visibleTabs).map((tab) => renderFooterTab(tab))}
    </nav>
  )

  /** The area the windows float over: the playspace, or an empty-state hint. */
  const workspace = (
    <div ref={areaRef} style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
          textAlign: 'center',
          padding: 'var(--space-6)',
          color: 'var(--color-text-muted)',
        }}
      >
        {hasPlayspace ? (
          <>
            {/* Placeholder until Phase 9 ships the battlemap. Deliberately plain:
                no fake map furniture implying a feature that isn't here. */}
            <strong style={{ fontSize: '1.05rem' }}>The playspace goes here</strong>
            <p style={{ margin: 0, fontSize: '0.85rem', maxWidth: 420 }}>
              This campaign plays as{' '}
              <strong>{campaign.game_mode === 'rpg' ? 'Full RPG' : 'Playspace'}</strong>, so the
              shared battlemap will fill this area
              {campaign.game_mode === 'rpg' ? ', along with the combat tracker.' : '.'} Open any
              section from the sidebar and drag its window wherever you like.
            </p>
          </>
        ) : (
          openCount === 0 && (
            <p style={{ margin: 0, fontSize: '0.9rem', maxWidth: 420 }}>
              Pick a section from the sidebar to open it. Each one opens in its own window, so you
              can keep several going at once and drag them wherever you like.
            </p>
          )
        )}
      </div>

      {layout.floating.map((panel, i) => {
        const tab = visibleTabs.find((t) => t.key === panel.key)
        if (!tab) return null
        return (
          <FloatingPanel
            key={panel.key}
            title={tab.label}
            rect={panel}
            // Array order IS stacking order, so the index is the z-index.
            zIndex={10 + i}
            bounds={bounds}
            onRectChange={(rect) => setPanelRect(panel.key, rect)}
            onFocus={() => focusPanel(panel.key)}
            onClose={() => closePanel(panel.key)}
          >
            <TabBody
              tab={tab}
              campaign={campaign}
              members={members}
              isDm={isDm}
              isOwner={isOwner}
              currentUserId={currentUserId}
              onRenamed={onRenamed}
              onModeChanged={onModeChanged}
              workspace={{
                railSide: layout.railSide,
                onRailSideChange: (side) => setLayout((l) => ({ ...l, railSide: side })),
                onResetLayout: resetLayout,
              }}
            />
          </FloatingPanel>
        )
      })}
    </div>
  )

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {onRight ? (
        <>
          {workspace}
          {rail}
        </>
      ) : (
        <>
          {rail}
          {workspace}
        </>
      )}
    </div>
  )
}

/** Shared style for the rail's control buttons (collapse, side, clear board). */
const railControl: React.CSSProperties = {
  font: 'inherit',
  fontSize: '0.85rem',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  color: 'var(--color-text-muted)',
  padding: 'var(--space-2) var(--space-3)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  flexShrink: 0,
}
