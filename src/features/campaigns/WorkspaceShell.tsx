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
 * **Closing a panel does not unmount it** (5.2.2a). A panel that has been opened
 * this session stays in the React tree, hidden with `display:none`, so closing
 * and reopening it is instant and preserves everything: loaded rows, scroll
 * position, a half-typed note, an expanded section. Unmounting meant every
 * reopen refetched and flashed a loading state, which made the rail feel like it
 * was reloading the app.
 *
 * The cost, stated plainly: a hidden panel's queries and realtime channels stay
 * live (5 panels use realtime), and its memory is retained until you leave the
 * campaign. That is the right trade here — a campaign has ~20 panels, not
 * hundreds — but it is a real cost, not a free win. The mounted set resets when
 * the campaign changes, so it cannot grow across a session.
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
import { BattlemapView } from '../playspace/BattlemapView'
import {
  clampRailWidth,
  clampRect,
  DEFAULT_FLOAT,
  MIN_FLOAT_H,
  MIN_FLOAT_W,
  DEFAULT_LAYOUT,
  DEFAULT_RAIL_W,
  loadLayout,
  sameRect,
  saveLayout,
  type CampaignLayout,
  type FloatRect,
} from './layout'
import { railFooterTabs, railTabs, type WorkspaceTab } from './tabs'
import { getRailSide } from '../profile/preferences'
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
 * @param characterUserId - Dev-only override for WHOSE character sheet the
 *        character-scoped panels show (9.1a). Undefined in every normal session;
 *        forwarded verbatim to TabBody, which defaults it to `currentUserId`.
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
  characterUserId,
  onRenamed,
  onModeChanged,
}: {
  campaign: Campaign
  visibleTabs: WorkspaceTab[]
  onActiveTabChange: (key: string) => void
  members: Member[]
  isDm: boolean
  isOwner: boolean
  currentUserId?: string
  characterUserId?: string
  onRenamed: (name: string) => void
  onModeChanged: (mode: GameMode) => void
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

  // Anything currently visible must be mounted; remember its rect as it moves so
  // a later reopen lands where the user left it.
  useEffect(() => {
    for (const panel of layout.floating) {
      rememberedRects.current.set(panel.key, { x: panel.x, y: panel.y, w: panel.w, h: panel.h })
    }
    setMountedKeys((m) => {
      const missing = layout.floating.map((p) => p.key).filter((k) => !m.includes(k))
      return missing.length ? [...m, ...missing] : m
    })
  }, [layout.floating])

  // Leaving the campaign drops every mounted panel — this is what stops the
  // mounted set (and its live subscriptions) growing without bound.
  useEffect(() => {
    rememberedRects.current.clear()
    setMountedKeys(loadLayout(campaign.id, visibleTabs).floating.map((p) => p.key))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id])

  // A panel this role may no longer see must be unmounted, not merely hidden —
  // otherwise its queries keep running after a demotion.
  useEffect(() => {
    const allowed = new Set(visibleTabs.map((t) => t.key))
    setMountedKeys((m) => (m.every((k) => allowed.has(k)) ? m : m.filter((k) => allowed.has(k))))
  }, [visibleTabs])

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

  // Every panel opened since arriving at this campaign. These stay mounted even
  // once closed (see the file header); `layout.floating` is still the source of
  // truth for what is *visible*.
  const [mountedKeys, setMountedKeys] = useState<string[]>(() =>
    loadLayout(campaign.id, visibleTabs).floating.map((p) => p.key),
  )
  // Where each panel was when it was closed, so reopening restores it there
  // rather than dumping it back at the default cascade position.
  const rememberedRects = useRef(new Map<string, FloatRect>())

  const openKeys = new Set(layout.floating.map((p) => p.key))
  /** The frontmost window's key, or undefined when nothing is open. */
  const frontKey = layout.floating[layout.floating.length - 1]?.key

  /**
   * The rect a panel opens at. Settings gets most of the screen: it is a stack
   * of dense administrative sections (name, mode, billing, backups, danger
   * zone) that is miserable to read in a 460px window, and it is not something
   * you arrange alongside other panels — you open it, do a thing, close it.
   *
   * @param key - Tab being opened.
   * @param count - How many windows are already open, for the cascade offset.
   */
  function openRectFor(key: string, count: number): FloatRect {
    if (key === 'settings' && bounds.w && bounds.h) {
      const margin = Math.min(48, Math.round(bounds.w * 0.05))
      return clampRect(
        {
          x: margin,
          y: margin,
          w: Math.max(MIN_FLOAT_W, bounds.w - margin * 2),
          h: Math.max(MIN_FLOAT_H, bounds.h - margin * 2),
        },
        bounds,
      )
    }
    const remembered = rememberedRects.current.get(key)
    if (remembered) return clampRect(remembered, bounds)
    const offset = (count % 6) * 28
    return clampRect(
      { ...DEFAULT_FLOAT, x: DEFAULT_FLOAT.x + offset, y: DEFAULT_FLOAT.y + offset },
      bounds,
    )
  }

  /**
   * Opens a panel as a floating window, cascading it clear of the ones already
   * open so a fresh window is never hidden exactly behind an old one.
   */
  function open(key: string) {
    onActiveTabChange(key)
    setLayout((l) => {
      if (l.floating.some((p) => p.key === key)) return l
      return { ...l, floating: [...l.floating, { key, ...openRectFor(key, l.floating.length) }] }
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
    } else if (key === 'settings' || frontKey === key) {
      // Settings is always on top, so there is no "raise" step to pass through —
      // clicking its entry while open can only mean close.
      closePanel(key)
    } else {
      focusPanel(key)
    }
  }

  /** Closes one window. */
  function closePanel(key: string) {
    setLayout((l) => ({ ...l, floating: l.floating.filter((p) => p.key !== key) }))
  }

  /**
   * Moves a panel to the end of the array, i.e. to the front of the stack.
   *
   * Settings is exempt in both directions: it renders at a fixed high z-index,
   * so reordering the array around it would change nothing visually while
   * making the "already frontmost?" test in handleRailClick lie.
   */
  function focusPanel(key: string) {
    if (key === 'settings') return
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
  // Read ONCE per mount, not per render: the rail side is an account preference
  // (profile/preferences.ts) and deliberately applies when a campaign workspace
  // opens rather than live. Flipping it under open, dragged windows re-ran the
  // whole relayout mid-interaction, which is where the edge-case drag bugs came
  // from. Changing it on the Profile page takes effect next time you open a
  // campaign — stated plainly in the Profile UI.
  const [railSide] = useState(getRailSide)
  const onRight = railSide === 'right'

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
            // Sits fully INSIDE the rail. It used to protrude 3px into the
            // workspace, which quietly stole the pixels next to a left-hand
            // rail: grabbing a window there resized the rail instead.
            [onRight ? 'left' : 'right']: 0,
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
      {/* The old "pick a section from the sidebar" hint used to live here. It
          was an absolutely-positioned full-area layer, and now that the map
          fills that area in every mode it would sit invisibly on top and
          swallow the first click of every drag. BattlemapView renders its own
          empty state instead, which says something more useful. */}
      {/* The map fills the workspace area in EVERY game mode (2026-08-28). It
          is a sibling of the floating windows, not their background: the windows
          are absolutely positioned over this area and must stay above it, which
          is why this renders first and claims no z-index of its own.

          `allowTokens` is the only difference between the modes: a notetaker
          campaign gets the map as shared reference art, with no tokens to place
          on it. Same component, same place, one capability fewer. */}
      <BattlemapView
        campaignId={campaign.id}
        members={members}
        isDm={isDm}
        currentUserId={currentUserId}
        allowTokens={hasPlayspace}
      />

      {/* Scrim behind Settings. It is modal in feel — always on top, filling
          most of the area — so dimming everything else makes that explicit
          rather than leaving the workspace looking interactive but inert.
          Click-through to dismiss is deliberately NOT wired: Settings holds
          destructive controls, and a stray click near the edge closing it
          mid-edit would be worse than an extra trip to the ✕. */}
      {openKeys.has('settings') && (
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 8999 }}
        />
      )}

      {mountedKeys.map((key) => {
        const tab = visibleTabs.find((t) => t.key === key)
        if (!tab) return null
        const i = layout.floating.findIndex((p) => p.key === key)
        const panel = i >= 0 ? layout.floating[i] : undefined
        // A closed panel is still rendered — hidden — so it keeps its state. It
        // needs a rect to render into; its remembered one holds its place.
        const rect = panel ?? rememberedRects.current.get(key) ?? DEFAULT_FLOAT
        return (
          <FloatingPanel
            key={key}
            hidden={!panel}
            fixed={key === 'settings'}
            title={tab.label}
            rect={rect}
            // Array order IS stacking order, so the index is the z-index —
            // except Settings, which is pinned above everything. It is a modal
            // sort of thing: you would never want it buried under a sheet you
            // opened to check something while changing a setting.
            zIndex={key === 'settings' ? 9000 : 10 + Math.max(0, i)}
            bounds={bounds}
            onRectChange={(r) => setPanelRect(key, r)}
            onFocus={() => focusPanel(key)}
            onClose={() => closePanel(key)}
          >
            <TabBody
              tab={tab}
              campaign={campaign}
              members={members}
              isDm={isDm}
              isOwner={isOwner}
              currentUserId={currentUserId}
              characterUserId={characterUserId}
              onRenamed={onRenamed}
              onModeChanged={onModeChanged}
              workspace={{ onResetLayout: resetLayout }}
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
