/**
 * QA/tools/layout-checks.mts — automated checks for the workspace-layout logic
 * (Phase 5.2).
 *
 * Why this exists: the interesting failure modes of `loadLayout` / `clampRect`
 * are all "what happens when storage holds something bad" — corrupt JSON, a
 * layout from an older build, coordinates from a bigger monitor. Reaching those
 * through the running app means pasting snippets into a browser console, which
 * is a step the user does not run, so those paths sat permanently unverified.
 *
 * But none of that logic needs a browser. It is pure functions over a string, so
 * we run them here against a stubbed `localStorage`. That is strictly better
 * evidence than a human pasting a snippet: it is repeatable, it runs in a second,
 * and it re-runs for free on every future change.
 *
 * This is NOT a general test runner — the project still has none (Phase 8). It is
 * a single-purpose script with a hand-rolled assert, deliberately dependency-free
 * beyond `tsx` for TypeScript loading.
 *
 * Run with: `npm run qa:checks`
 */
import {
  snapToEdges,
  clampRailWidth,
  clampRect,
  DEFAULT_LAYOUT,
  DEFAULT_RAIL_W,
  RAIL_MAX_W,
  RAIL_MIN_W,
  LAYOUT_VERSION,
  loadLayout,
  saveLayout,
  layoutStorageKey,
  MIN_FLOAT_H,
  MIN_FLOAT_W,
  type CampaignLayout,
} from '../../src/features/campaigns/layout.ts'
import type { WorkspaceTab } from '../../src/features/campaigns/tabs.ts'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory `localStorage`, installed as a global before importing
 * anything that touches it. Only the three methods layout.ts uses are provided;
 * anything else would be unused surface area.
 */
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

let passed = 0
const failures: string[] = []

/**
 * Records a check. Never throws, so one failure doesn't hide the rest — the run
 * reports every result and exits non-zero at the end if any failed.
 *
 * @param name - What is being asserted, phrased as the expected behavior.
 * @param ok - Whether it held.
 * @param detail - Observed value, printed only on failure.
 */
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failures.push(name)
    console.log(`  FAIL ${name}${detail === undefined ? '' : `\n       got: ${JSON.stringify(detail)}`}`)
  }
}

/** Test fixtures: a campaign id and the tab list a DM would see. */
const CID = 'test-campaign'
const KEY = layoutStorageKey(CID)
const tabs = (...keys: string[]): WorkspaceTab[] =>
  keys.map((key) => ({ key, label: key, audience: 'all', blurb: '' }))
const DM_TABS = tabs('overview', 'npcs', 'secretnotes', 'settings')
const PLAYER_TABS = tabs('overview', 'character', 'journal')

/** Writes a raw string to storage, bypassing saveLayout's stamping. */
const put = (raw: string) => store.set(KEY, raw)

// ---------------------------------------------------------------------------
// loadLayout — untrusted input
// ---------------------------------------------------------------------------

console.log('\nloadLayout — untrusted input')

store.clear()
check('absent layout returns the default', loadLayout(CID, DM_TABS).railWidth === DEFAULT_LAYOUT.railWidth)

put('{not json')
check(
  'corrupt JSON degrades to the default instead of throwing',
  loadLayout(CID, DM_TABS).floating.length === 0 &&
    loadLayout(CID, DM_TABS).railWidth === DEFAULT_LAYOUT.railWidth,
)

put('null')
check('literal null degrades to the default', loadLayout(CID, DM_TABS).railWidth === DEFAULT_LAYOUT.railWidth)

put('"a string"')
check('a non-object degrades to the default', loadLayout(CID, DM_TABS).floating.length === 0)

put(JSON.stringify({ v: LAYOUT_VERSION, sidebarCollapsed: false, railSide: 'right', floating: 'nope' }))
check('a non-array `floating` degrades to no windows', loadLayout(CID, DM_TABS).floating.length === 0)

// ---------------------------------------------------------------------------
// loadLayout — schema versioning
// ---------------------------------------------------------------------------

console.log('\nloadLayout — schema versioning')

// The exact shape 5.2.1b/5.2.1c wrote: no version stamp, and a `drawerOpen`
// field that no longer exists. This is what every existing browser holds.
put(JSON.stringify({ sidebarCollapsed: true, drawerOpen: true, floating: [{ key: 'npcs', x: 10, y: 10, w: 400, h: 400 }] }))
const unversioned = loadLayout(CID, DM_TABS)
check('an unversioned (pre-5.2.1d) layout is discarded wholesale', unversioned.floating.length === 0, unversioned)
check('...and the discard restores the default collapse state', unversioned.sidebarCollapsed === false)

put(JSON.stringify({ v: LAYOUT_VERSION + 1, sidebarCollapsed: true, railSide: 'left', floating: [] }))
check('a FUTURE version is also discarded, not partially trusted', loadLayout(CID, DM_TABS).sidebarCollapsed === false)

// railSide moved to account preferences in 5.2.2b. A layout still carrying it is
// kept, not discarded — the field is simply ignored, nothing else changes
// meaning, and binning everyone's arrangement over a dead key would be pure loss.
put(JSON.stringify({ v: LAYOUT_VERSION, sidebarCollapsed: true, railSide: 'left', railWidth: 240, floating: [] }))
const withDeadField = loadLayout(CID, DM_TABS)
check('a layout carrying the retired railSide field is kept, not discarded',
  withDeadField.sidebarCollapsed === true && withDeadField.railWidth === 240, withDeadField)
check('...and the retired field does not survive into the parsed layout',
  !('railSide' in withDeadField), Object.keys(withDeadField))

// The retired 'billing' key: covered by versioning, but also by tab filtering
// for anything written at the current version.
put(JSON.stringify({ v: LAYOUT_VERSION, sidebarCollapsed: false, railSide: 'right', floating: [{ key: 'billing', x: 10, y: 10, w: 400, h: 400 }] }))
check('a window for a tab no longer in the catalog is dropped', loadLayout(CID, DM_TABS).floating.length === 0)

// ---------------------------------------------------------------------------
// loadLayout — role gating
// ---------------------------------------------------------------------------

console.log('\nloadLayout — role gating')

const dmLayout: CampaignLayout = {
  sidebarCollapsed: false,
  railWidth: DEFAULT_RAIL_W,
  floating: [
    { key: 'secretnotes', x: 10, y: 10, w: 400, h: 400 },
    { key: 'overview', x: 20, y: 20, w: 400, h: 400 },
  ],
}
saveLayout(CID, dmLayout)
check('a DM restores their DM-only window', loadLayout(CID, DM_TABS).floating.length === 2)
const asPlayer = loadLayout(CID, PLAYER_TABS)
check(
  'the same stored layout gives a PLAYER no DM-only window',
  asPlayer.floating.length === 1 && asPlayer.floating[0].key === 'overview',
  asPlayer.floating,
)

// ---------------------------------------------------------------------------
// loadLayout — geometry & duplicates
// ---------------------------------------------------------------------------

console.log('\nloadLayout — geometry & duplicates')

put(JSON.stringify({ v: LAYOUT_VERSION, sidebarCollapsed: false, railSide: 'right', floating: [
  { key: 'npcs', x: -9000, y: -9000, w: 10, h: 10 },
] }))
const tiny = loadLayout(CID, DM_TABS).floating[0]
// loadLayout no longer clamps x itself: horizontal position is bounds-relative,
// and the bounds are unknown until the area is measured. clampRect owns it.
check('a negative y is clamped to zero at load', tiny.y === 0, tiny)
check('sub-minimum sizes are raised to the minimum', tiny.w === MIN_FLOAT_W && tiny.h === MIN_FLOAT_H, tiny)
check('...and a wildly off-screen x is recovered by clampRect', (() => {
  const r = clampRect(tiny, { w: 800, h: 600 })
  return r.x + r.w > 0 && r.x < 800
})(), clampRect(tiny, { w: 800, h: 600 }))

put(JSON.stringify({ v: LAYOUT_VERSION, sidebarCollapsed: false, railSide: 'right', floating: [
  { key: 'npcs', x: 1, y: 1, w: 400, h: 400 },
  { key: 'npcs', x: 2, y: 2, w: 400, h: 400 },
] }))
check('a duplicated tab key yields exactly one window', loadLayout(CID, DM_TABS).floating.length === 1)

put(JSON.stringify({ v: LAYOUT_VERSION, sidebarCollapsed: false, railSide: 'right', floating: [
  { key: 'npcs', x: Number.NaN, y: 0, w: 400, h: 400 },
  { key: 'settings', x: 0, y: 0, w: 400, h: Number.POSITIVE_INFINITY },
] }))
check('non-finite coordinates are rejected entirely', loadLayout(CID, DM_TABS).floating.length === 0)

put(JSON.stringify({ v: LAYOUT_VERSION, sidebarCollapsed: 'yes', railWidth: 'wide', floating: [] }))
const badTypes = loadLayout(CID, DM_TABS)
check('a non-boolean collapse falls back to the default', badTypes.sidebarCollapsed === false)
check('a non-numeric rail width falls back to the default', badTypes.railWidth === DEFAULT_RAIL_W, badTypes.railWidth)

// ---------------------------------------------------------------------------
// clampRailWidth — the draggable rail (5.2.1e)
// ---------------------------------------------------------------------------

console.log('\nclampRailWidth — draggable rail')

check('a sensible width passes through', clampRailWidth(260) === 260)
check('a too-narrow width is raised to the minimum', clampRailWidth(10) === RAIL_MIN_W)
check('a too-wide width is capped at the maximum', clampRailWidth(99999) === RAIL_MAX_W)
check('a missing width falls back to the default', clampRailWidth(undefined) === DEFAULT_RAIL_W)
check('a non-number width falls back to the default', clampRailWidth('wide') === DEFAULT_RAIL_W)
check('NaN falls back to the default', clampRailWidth(Number.NaN) === DEFAULT_RAIL_W)
check('a fractional width is rounded to whole px', Number.isInteger(clampRailWidth(210.4)))

// railWidth was added AFTER v1 shipped and deliberately did not bump the version,
// because it is additive with a default — a v1 layout is still meaningful and the
// user should keep their arrangement rather than lose it over a missing field.
put(JSON.stringify({ v: LAYOUT_VERSION, sidebarCollapsed: true, railSide: 'left', floating: [] }))
const noWidth = loadLayout(CID, DM_TABS)
check('a v1 layout with no railWidth is KEPT, not discarded', noWidth.sidebarCollapsed === true, noWidth)
check('...and gets the default rail width', noWidth.railWidth === DEFAULT_RAIL_W)

put(JSON.stringify({ v: LAYOUT_VERSION, sidebarCollapsed: false, railSide: 'right', railWidth: 5000, floating: [] }))
check('an out-of-range stored rail width is clamped on load', loadLayout(CID, DM_TABS).railWidth === RAIL_MAX_W)

// ---------------------------------------------------------------------------
// clampRect — the off-screen bug fixed in 5.2.1d
// ---------------------------------------------------------------------------

console.log('\nclampRect — off-screen recovery')

const AREA = { w: 800, h: 600 }

check(
  'a window that already fits is returned untouched',
  JSON.stringify(clampRect({ x: 50, y: 50, w: 400, h: 300 }, AREA)) ===
    JSON.stringify({ x: 50, y: 50, w: 400, h: 300 }),
)

// The actual bug: saved at x=3000 on a wide monitor, reopened at 800px wide.
const rescued = clampRect({ x: 3000, y: 2000, w: 400, h: 300 }, AREA)
check('a far-off-screen window is pulled back inside the area', rescued.x < AREA.w && rescued.y < AREA.h, rescued)
check('...leaving enough of it visible to grab', rescued.x <= AREA.w - 80 && rescued.y <= AREA.h - 40, rescued)

const oversized = clampRect({ x: 0, y: 0, w: 5000, h: 4000 }, AREA)
check('an oversized window is shrunk to fit the area', oversized.w <= AREA.w && oversized.h <= AREA.h, oversized)
check('...but never below the minimum', oversized.w >= MIN_FLOAT_W && oversized.h >= MIN_FLOAT_H, oversized)
check('...and is not shoved off the left edge doing so', oversized.x >= 0, oversized)

// Horizontal hang-off is symmetric (5.2.1j): a window may sit partly off the
// LEFT edge exactly as it may off the right, so long as some stays grabbable.
// It used to hard-stop at x = 0, which read as "I can't drag it all the way
// over" when the rail was on the left.
const hangLeft = clampRect({ x: -200, y: 40, w: 460, h: 400 }, AREA)
check('a window may hang off the left edge', hangLeft.x < 0, hangLeft)
check('...but never so far that nothing is grabbable', hangLeft.x + hangLeft.w >= 80, hangLeft)
check('the top edge is still a hard stop (title bar is the only handle)',
  clampRect({ x: 10, y: -500, w: 460, h: 400 }, AREA).y === 0)

// Degenerate: a viewport narrower than the minimum window width still leaves the
// window overlapping the visible area rather than parked outside it.
const tinyArea = clampRect({ x: 500, y: 500, w: 400, h: 300 }, { w: 40, h: 20 })
check('a viewport smaller than the window keeps it overlapping the area',
  tinyArea.x < 40 && tinyArea.x + tinyArea.w > 0 && tinyArea.y >= 0, tinyArea)

check(
  'clamping is idempotent, so the correcting effect cannot loop',
  JSON.stringify(clampRect(rescued, AREA)) === JSON.stringify(rescued),
)

check(
  'an unmeasured area (zero size) leaves the rect alone',
  clampRect({ x: 3000, y: 3000, w: 400, h: 300 }, { w: 0, h: 0 }).x === 3000,
)

// ---------------------------------------------------------------------------
// snapToEdges — "lock it to the border" (5.2.2b)
// ---------------------------------------------------------------------------

console.log('\nsnapToEdges — flush to the border')

check('a window dropped near the left edge snaps flush',
  snapToEdges({ x: 9, y: 200, w: 400, h: 300 }, AREA).x === 0)
check('a window dropped near the right edge snaps flush',
  snapToEdges({ x: 395, y: 200, w: 400, h: 300 }, AREA).x === AREA.w - 400)
check('a window dropped near the top snaps flush',
  snapToEdges({ x: 200, y: 6, w: 400, h: 300 }, AREA).y === 0)
check('a window dropped near the bottom snaps flush',
  snapToEdges({ x: 200, y: 295, w: 400, h: 300 }, AREA).y === AREA.h - 300)
check('a corner drop snaps on BOTH axes',
  (() => { const r = snapToEdges({ x: 5, y: 5, w: 400, h: 300 }, AREA); return r.x === 0 && r.y === 0 })())
check('a window dropped well clear of an edge is left alone',
  (() => { const r = snapToEdges({ x: 200, y: 200, w: 400, h: 300 }, AREA); return r.x === 200 && r.y === 200 })())
check('a window wider than the area is not snapped horizontally',
  snapToEdges({ x: 5, y: 200, w: 2000, h: 300 }, AREA).x === 5)
check('an unmeasured area leaves the rect alone',
  snapToEdges({ x: 5, y: 5, w: 400, h: 300 }, { w: 0, h: 0 }).x === 5)

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

console.log('\nsaveLayout / loadLayout round trip')

store.clear()
const arranged: CampaignLayout = {
  sidebarCollapsed: true,
  railWidth: 275,
  floating: [
    { key: 'overview', x: 12, y: 34, w: 500, h: 400 },
    { key: 'npcs', x: 56, y: 78, w: 600, h: 450 },
  ],
}
saveLayout(CID, arranged)
const restored = loadLayout(CID, DM_TABS)
check('a saved arrangement round-trips exactly', JSON.stringify(restored) === JSON.stringify(arranged), restored)
check('...and stacking order is preserved', restored.floating[1].key === 'npcs')
check('saveLayout stamps the current schema version', JSON.parse(store.get(KEY)!).v === LAYOUT_VERSION)

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
