/**
 * campaigns/layout.ts — the per-user, per-campaign workspace layout for the
 * playspace shell (Phase 5.2).
 *
 * Owns: the shape of "how the DM/player has arranged this campaign's panels" —
 * whether the rail is collapsed, which side of the window it is on, and which
 * panels are open as floating windows and where they sit — plus loading/saving
 * it to localStorage.
 *
 * This is deliberately client-only state, exactly like the existing
 * `campaign:<id>:activeTab` key. It is a *view preference*, not campaign data:
 * it must not sync between users (two players want different arrangements), it
 * is worthless to anyone else, and losing it costs nothing. That is why it never
 * goes near Postgres and therefore has no RLS story.
 *
 * Storage is keyed per campaign so each campaign remembers its own arrangement,
 * and per browser profile so each of a user's devices can differ.
 */
import type { WorkspaceTab } from './tabs'

/** Where a floating panel sits, in CSS pixels relative to the playspace area. */
export interface FloatRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * One popped-out panel. `key` is a WorkspaceTab key; the array's ORDER is the
 * stacking order (last = frontmost), which is why focusing a panel moves it to
 * the end rather than storing an explicit z-index that would need compacting.
 */
export interface FloatingPanelState extends FloatRect {
  key: string
}

/**
 * Schema version of the persisted layout.
 *
 * Bump this whenever the stored shape changes meaning — a field removed, renamed,
 * or reinterpreted, or a tab key retired from the catalog. `loadLayout` discards
 * any layout not carrying the current version, so stale blobs are dropped
 * wholesale instead of being pruned field-by-field forever after.
 *
 * This is worth the one-line cost because it has already bitten twice: the
 * 'billing' tab key was retired in 5.2.1b and the `drawerOpen` field in 5.2.1c,
 * each of which otherwise needs its own defensive branch and its own test case.
 * Discarding costs the user one re-arrangement; carrying migrations for a view
 * preference costs us forever.
 *
 * History: 1 — first versioned schema (5.2.1c). `railWidth` was added (5.2.1e)
 * and `railSide` removed (5.2.2b, moved to account preferences) WITHOUT bumping:
 * an addition with a default, and a removal whose field is simply ignored,
 * leave every remaining field meaning exactly what it did. The bump is for
 * changes that would make stale data *misread*, not for any edit to the shape —
 * discarding everyone's arrangement over a dead key would be pure loss.
 */
export const LAYOUT_VERSION = 1

/**
 * Rail width bounds, in px. The minimum still fits the shortest section labels;
 * the maximum stops the rail eating the workspace it exists to navigate.
 */
export const RAIL_MIN_W = 140
export const RAIL_MAX_W = 480
/** Rail width before the user has dragged it. */
export const DEFAULT_RAIL_W = 190

/**
 * The whole arrangement for one campaign.
 *  - sidebarCollapsed: the nav rail is narrowed to just its toggle.
 *  (Which EDGE the rail sits on is deliberately NOT here — it moved to
 *  account-level preferences in 5.2.2b, since it is a handedness preference
 *  that should follow the user across campaigns. See profile/preferences.ts.)
 *  - railWidth:        expanded width in px, dragged by the user. Ignored while
 *                      collapsed, and preserved across a collapse/expand cycle
 *                      so expanding returns the rail to the size you chose.
 *  - floating:         open panels, back-to-front.
 *
 * There is deliberately no "docked panel" state any more: since 5.2.1c a rail
 * click opens a floating window directly, so every open panel is in `floating`
 * and open/closed is simply presence in that array. Older saved layouts carrying
 * a `drawerOpen` field are ignored rather than migrated — it describes a mode of
 * the UI that no longer exists.
 */
export interface CampaignLayout {
  sidebarCollapsed: boolean
  railWidth: number
  floating: FloatingPanelState[]
}

/** What actually goes to storage: the layout plus its schema version. */
interface StoredLayout extends CampaignLayout {
  v: number
}

/** The arrangement a campaign gets before the user has touched anything. */
export const DEFAULT_LAYOUT: CampaignLayout = {
  sidebarCollapsed: false,
  railWidth: DEFAULT_RAIL_W,
  floating: [],
}

/**
 * Constrains a rail width to its bounds, tolerating rubbish.
 *
 * `railWidth` was added after LAYOUT_VERSION 1 shipped. It is purely additive
 * with a sensible default, so it deliberately did NOT bump the version: an older
 * v1 layout is still fully meaningful and should keep the user's arrangement
 * rather than be discarded over a field it simply lacks.
 *
 * @param w - Candidate width; anything non-finite falls back to the default.
 * @returns A width inside [RAIL_MIN_W, RAIL_MAX_W].
 */
export function clampRailWidth(w: unknown): number {
  if (typeof w !== 'number' || !Number.isFinite(w)) return DEFAULT_RAIL_W
  return Math.min(RAIL_MAX_W, Math.max(RAIL_MIN_W, Math.round(w)))
}

/** Size a panel gets the first time it is popped out. */
export const DEFAULT_FLOAT: FloatRect = { x: 48, y: 48, w: 460, h: 420 }

/** Floating panels never shrink below this — smaller is unusable, not resizable. */
export const MIN_FLOAT_W = 300
export const MIN_FLOAT_H = 200

/**
 * How much of a window must stay inside the workspace area. Enough of the title
 * bar to grab and to read a word or two of the title.
 */
const KEEP_VISIBLE_X = 80
const KEEP_VISIBLE_Y = 40

/**
 * Pulls a window back inside the workspace area.
 *
 * Horizontal movement is deliberately **symmetric**: a window may hang off the
 * left edge exactly as far as it may hang off the right, provided
 * KEEP_VISIBLE_X of it stays on screen. It used to be hard-stopped at x = 0,
 * which meant you could shove a window off the right but not the left — and
 * with the rail on the left that read as "I can't drag it all the way over".
 * Vertically the top IS a hard stop, because the title bar is the only drag
 * handle and pushing it above the top edge would strand the window.
 *
 * Needed because a saved position outlives the viewport that produced it: a
 * window parked near the right edge of a wide monitor, reopened in a narrow
 * window, would otherwise restore at coordinates outside the area — and since
 * that area is `overflow: hidden`, the window would be invisible and completely
 * unreachable, with no scrollbar to chase it. Clamping at save time can't fix
 * this (the viewport we'll next open in is unknowable), so it has to happen
 * against the measured area, every time it changes.
 *
 * Oversized windows are shrunk to fit before being moved, so a window wider than
 * the area doesn't get shoved off the left edge trying to satisfy the right one.
 *
 * @param rect - The stored position/size.
 * @param bounds - Measured workspace area. A zero dimension means "not measured
 *                 yet"; the rect is returned untouched rather than clamped to
 *                 nothing.
 * @returns The rect to actually render, unchanged when it already fits.
 */
export function clampRect(rect: FloatRect, bounds: { w: number; h: number }): FloatRect {
  if (!bounds.w || !bounds.h) return rect
  const w = Math.max(MIN_FLOAT_W, Math.min(rect.w, bounds.w))
  const h = Math.max(MIN_FLOAT_H, Math.min(rect.h, bounds.h))
  const minX = Math.min(0, KEEP_VISIBLE_X - w)
  const x = Math.min(Math.max(minX, rect.x), Math.max(minX, bounds.w - KEEP_VISIBLE_X))
  const y = Math.min(Math.max(0, rect.y), Math.max(0, bounds.h - KEEP_VISIBLE_Y))
  return { x, y, w, h }
}

/** How close to an edge a window must be dropped before it snaps flush. */
export const SNAP_PX = 14

/**
 * Snaps a window flush to any workspace edge it was dropped near.
 *
 * Without this, "put it against the side" is a pixel-hunt: the drag clamp lets a
 * window hang off an edge, so it is easy to end up a few pixels short of, or
 * past, the border and never quite flush. Snapping is applied once, on release,
 * so it never fights the pointer mid-drag.
 *
 * Each axis is independent — a window dropped in the top-right corner snaps to
 * both — and a window larger than the area is left alone on that axis, since
 * there is no meaningful edge to choose.
 *
 * @param rect - The rect at the moment of release.
 * @param bounds - Measured workspace area; a zero dimension means unmeasured.
 * @returns The rect to commit, unchanged when nothing was near an edge.
 */
export function snapToEdges(rect: FloatRect, bounds: { w: number; h: number }): FloatRect {
  if (!bounds.w || !bounds.h) return rect
  let { x, y } = rect
  if (rect.w <= bounds.w) {
    if (Math.abs(x) <= SNAP_PX) x = 0
    else if (Math.abs(x + rect.w - bounds.w) <= SNAP_PX) x = bounds.w - rect.w
  }
  if (rect.h <= bounds.h) {
    if (Math.abs(y) <= SNAP_PX) y = 0
    else if (Math.abs(y + rect.h - bounds.h) <= SNAP_PX) y = bounds.h - rect.h
  }
  return { ...rect, x, y }
}

/** True when two rects are identical — used to skip no-op state updates. */
export function sameRect(a: FloatRect, b: FloatRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/** localStorage key holding the layout for a given campaign. */
export function layoutStorageKey(campaignId: string): string {
  return `campaign:${campaignId}:layout`
}

/**
 * Reads the saved layout for a campaign, dropping anything unusable.
 *
 * Everything here is defensive because the input is untrusted: it may be absent,
 * hand-edited, or written by an older build of the app. Any parse failure or
 * malformed field degrades to the default rather than throwing — a corrupt view
 * preference must never be able to break the workspace.
 *
 * @param campaignId - Campaign whose layout to load.
 * @param visibleTabs - The tabs this caller may currently see. Floating panels
 *   for any other key are DISCARDED. The version check above handles tabs that
 *   left the CATALOG; this handles the case version can't see — the same build
 *   showing the same layout to a caller whose ROLE changed, where the stored
 *   blob is perfectly current but its contents are no longer theirs to open.
 * @returns A layout safe to render.
 */
export function loadLayout(campaignId: string, visibleTabs: WorkspaceTab[]): CampaignLayout {
  let parsed: unknown
  try {
    const raw = localStorage.getItem(layoutStorageKey(campaignId))
    if (!raw) return DEFAULT_LAYOUT
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_LAYOUT
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_LAYOUT
  const obj = parsed as Partial<StoredLayout>

  // Written by a different schema — discard rather than guess. See LAYOUT_VERSION.
  if (obj.v !== LAYOUT_VERSION) return DEFAULT_LAYOUT

  const allowed = new Set(visibleTabs.map((t) => t.key))
  const floating = Array.isArray(obj.floating)
    ? obj.floating
        .filter(
          (p): p is FloatingPanelState =>
            !!p &&
            typeof p === 'object' &&
            typeof p.key === 'string' &&
            allowed.has(p.key) &&
            [p.x, p.y, p.w, p.h].every((n) => typeof n === 'number' && Number.isFinite(n)),
        )
        // Clamp on the way in as well as on the way out: a window saved on a
        // wide monitor must not restore off-screen on a laptop.
        .map((p) => ({
          key: p.key,
          // No lower clamp here — clampRect applies the real bounds once the
          // area is measured, and it permits a negative x by design.
          x: p.x,
          y: Math.max(0, p.y),
          w: Math.max(MIN_FLOAT_W, p.w),
          h: Math.max(MIN_FLOAT_H, p.h),
        }))
        // One window per tab — a duplicate entry would mount the panel twice
        // and run two copies of its queries and realtime subscriptions.
        .filter((p, i, all) => all.findIndex((q) => q.key === p.key) === i)
    : []

  return {
    sidebarCollapsed:
      typeof obj.sidebarCollapsed === 'boolean'
        ? obj.sidebarCollapsed
        : DEFAULT_LAYOUT.sidebarCollapsed,
    railWidth: clampRailWidth(obj.railWidth),
    floating,
  }
}

/**
 * Persists a campaign's layout. Silently ignores storage failures (private
 * browsing, quota) — losing a view preference is not worth surfacing an error.
 *
 * @param campaignId - Campaign whose layout to save.
 * @param layout - The arrangement to store.
 */
export function saveLayout(campaignId: string, layout: CampaignLayout): void {
  try {
    const stored: StoredLayout = { ...layout, v: LAYOUT_VERSION }
    localStorage.setItem(layoutStorageKey(campaignId), JSON.stringify(stored))
  } catch {
    /* ignore — view preference only */
  }
}

/**
 * Selects the layout keys from a list of localStorage keys (Phase 7.3.1).
 *
 * Split out as a pure function so the "reset every campaign's layout" action can
 * be tested without a browser — see QA/tools/layout-checks.mts. The matching is
 * the whole risk in that feature: this runs across the user's ENTIRE
 * localStorage, and a pattern that is one character too greedy would take out
 * their tab selections, their rail-side preference, or anything else the app (or
 * another app on the same origin) has stored.
 *
 * Deliberately anchored and exact-shaped: `campaign:<id>:layout` and nothing
 * else. In particular `campaign:<id>:activeTab` and `campaign:<id>:view` must
 * survive — those are "where was I", not "how was it arranged", and clearing
 * them would dump the user back on the overview of every campaign for no reason
 * they asked for.
 *
 * @param keys - Every key currently in localStorage.
 * @returns Just the per-campaign layout keys, in the order given.
 */
export function selectLayoutKeys(keys: string[]): string[] {
  return keys.filter((k) => /^campaign:[^:]+:layout$/.test(k))
}

/**
 * Clears the saved workspace arrangement for EVERY campaign.
 *
 * The global escape hatch for when something is wrong across all campaigns at
 * once — the per-campaign "Reset layout" in campaign Settings only helps if you
 * can still open that campaign. Nothing is lost that is not view state: layouts
 * are browser-local and never synced.
 *
 * Storage failures are swallowed (private browsing, quota) and reported as a
 * count of zero rather than an exception — a view preference is never worth
 * breaking the page over.
 *
 * @returns How many campaign layouts were removed.
 */
export function resetAllLayouts(): number {
  try {
    // Enumerate via length/key(i) rather than Object.keys: that is the
    // Storage API proper, and it behaves identically in a browser and under a
    // stub, which is what lets QA/tools test this at all.
    //
    // Snapshot the keys BEFORE deleting anything: localStorage is a live index,
    // so removing while iterating by position silently skips entries.
    const all: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k !== null) all.push(k)
    }
    const keys = selectLayoutKeys(all)
    for (const k of keys) localStorage.removeItem(k)
    return keys.length
  } catch {
    return 0
  }
}
