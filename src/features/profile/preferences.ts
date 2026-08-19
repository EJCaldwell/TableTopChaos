/**
 * profile/preferences.ts — account-level UI preferences, stored per browser.
 *
 * Distinct from `campaigns/layout.ts`, which holds *per-campaign* arrangement
 * (which panels are open, where). These are settings that should follow the user
 * across every campaign they are in — currently just which side the workspace
 * tab rail sits on.
 *
 * **Why this is global, and why it applies on load rather than live.** The rail
 * side started life as a per-campaign layout field flipped from inside the
 * campaign Settings panel. Two problems: nobody wants the rail on the left in
 * one campaign and the right in another — it is a handedness preference, not a
 * property of a campaign — and flipping it live re-runs the whole workspace
 * relayout underneath open, dragged windows, which is a rich source of
 * edge-case bugs. Moving it here fixes the first and sidesteps the second: the
 * value is read when a campaign workspace mounts, so changing it takes effect
 * next time you open a campaign.
 *
 * Like the layout, this is a view preference: browser-local, never synced,
 * worthless to anyone else, and harmless to lose. It never goes near Postgres
 * and so has no RLS story.
 */

/** Which edge the workspace tab rail sits on. */
export type RailSide = 'left' | 'right'

/** localStorage key. Account-wide, so deliberately not campaign-scoped. */
const RAIL_SIDE_KEY = 'prefs:railSide'

/**
 * The side a new user gets. Right-hand default: the panels you are reading sit
 * under your cursor's resting side, and it keeps the rail clear of the app
 * header's home link.
 */
export const DEFAULT_RAIL_SIDE: RailSide = 'right'

/**
 * Reads the stored rail side, tolerating absent or junk values.
 * @returns A usable side; the default if nothing valid is stored.
 */
export function getRailSide(): RailSide {
  try {
    const raw = localStorage.getItem(RAIL_SIDE_KEY)
    return raw === 'left' || raw === 'right' ? raw : DEFAULT_RAIL_SIDE
  } catch {
    return DEFAULT_RAIL_SIDE
  }
}

/**
 * Stores the rail side. Silently ignores storage failures (private browsing,
 * quota) — losing a view preference is not worth surfacing an error.
 * @param side - The side to store.
 */
export function setRailSide(side: RailSide): void {
  try {
    localStorage.setItem(RAIL_SIDE_KEY, side)
  } catch {
    /* ignore — view preference only */
  }
}
