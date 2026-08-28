/**
 * profile/username.ts — the username rules, mirrored client-side.
 *
 * The DATABASE is the authority: `private.is_valid_username` (migration 0039)
 * plus the `profiles_username_lower_key` unique index. Everything here exists
 * only to fail fast and say why, so a user is not told "that didn't work" after
 * a round trip that a local check could have answered.
 *
 * **These rules must be kept in step with 0039 by hand.** If they drift, the
 * failure is one-directional and benign: the server still refuses anything
 * illegal. The drift that would actually hurt is the reverse — this file being
 * *stricter* than the database, silently forbidding names that are legal — so
 * when in doubt, loosen here rather than tighten.
 *
 * NOT MIRRORED HERE: THE LANGUAGE FILTER. Migration 0044 also blocks profanity
 * and slurs, and that check is deliberately server-only. Shipping the word list
 * to the browser would publish it — handing out a ready-made slur dictionary and
 * telling anyone evading it exactly what to avoid. The cost is one round trip to
 * find out; the server returns a friendly, deliberately vague message
 * ("That username is not available") which the UI shows as-is.
 *
 * WHY THERE IS NO `isUsernameAvailable()`. `profiles` is readable only by
 * yourself and your co-members (migrations 0002 + 0004), so nobody can
 * enumerate who exists — a privacy property worth keeping. Checking
 * availability with a SELECT would return nothing useful anyway (RLS hides the
 * conflicting row), and a SECURITY DEFINER RPC to answer it would create
 * exactly the enumeration surface those policies avoid. So availability is
 * discovered by ATTEMPTING THE WRITE and reading SQLSTATE 23505 back — see
 * {@link isUsernameTakenError}.
 */

/** Minimum length. Matches the `{2,19}` tail of the DB regex (1 + 2 = 3). */
export const USERNAME_MIN = 3
/** Maximum length — long enough to be distinctive, short enough for a roster line. */
export const USERNAME_MAX = 20

/**
 * Mirror of the DB regex: starts with a letter or digit, then letters, digits
 * or underscores.
 */
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_]{2,19}$/

/**
 * Named exceptions to the {@link USERNAME_MIN} floor (migrations 0042, 0043).
 *
 * Mirrors the array inside `private.is_valid_username`. These are legal despite
 * being under the minimum; they are NOT owned — the database grants legality,
 * and whoever holds one keeps it only because the unique index says so.
 *
 * Compared lowercased, matching how uniqueness works.
 */
const SHORT_NAME_EXCEPTIONS = new Set([
  'ej', // the owner's handle (migration 0042)
  'qa', // the QA fixture account (migration 0043)
])

/**
 * Mirror of `private.is_reserved_username`. Compared lowercased.
 *
 * Kept as a literal list rather than fetched, because the only alternative — an
 * endpoint that answers "is this name reserved?" — is a step toward the
 * enumeration API this design is avoiding.
 */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'helpdesk',
  'moderator', 'mod', 'staff', 'team', 'official', 'security', 'abuse',
  'billing', 'payments', 'noreply', 'no-reply', 'postmaster', 'webmaster',
  'api', 'www', 'app', 'auth', 'login', 'signup', 'settings', 'profile',
  'campaign', 'campaigns', 'dm', 'gm', 'tabletopchaos', 'ttc',
  'me', 'you', 'everyone', 'anyone', 'anonymous', 'deleted', 'null',
  'undefined', 'none', 'unknown', 'guest',
])

/**
 * Validates a username locally.
 *
 * Messages name the specific rule broken rather than restating all of them:
 * "Usernames can only contain letters, numbers and underscores" tells you what
 * to change; a wall of rules makes you find your own mistake.
 *
 * @param raw - The candidate, as typed (not trimmed).
 * @returns An error message, or null when it looks valid.
 */
export function validateUsername(raw: string): string | null {
  const name = raw.trim()
  if (name.length === 0) return 'Choose a username.'
  // The exception check has to come before the length check, or a listed short
  // name is rejected here and never reaches the database that would allow it.
  const excepted = SHORT_NAME_EXCEPTIONS.has(name.toLowerCase())
  if (!excepted && name.length < USERNAME_MIN) {
    return `Usernames need at least ${USERNAME_MIN} characters.`
  }
  if (name.length > USERNAME_MAX) return `Usernames can be at most ${USERNAME_MAX} characters.`
  if (!/^[A-Za-z0-9]/.test(name)) return 'Usernames must start with a letter or number.'
  if (!excepted && !USERNAME_PATTERN.test(name)) {
    return 'Usernames can only contain letters, numbers and underscores.'
  }
  if (RESERVED.has(name.toLowerCase())) return 'That username is reserved. Please pick another.'
  return null
}

/**
 * True when a Supabase error is a username collision.
 *
 * The unique index is case-insensitive (`lower(username)`), so this fires for
 * `Alex` when `alex` exists — which is the point, and is why the message shown
 * to the user must not suggest that changing the capitalisation would help.
 *
 * @param error - The error from a profiles insert/update.
 */
export function isUsernameTakenError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  )
}

/** The message shown for a collision. Single-sourced so every caller agrees. */
export const USERNAME_TAKEN_MESSAGE =
  'That username is already taken — including in a different capitalisation.'
