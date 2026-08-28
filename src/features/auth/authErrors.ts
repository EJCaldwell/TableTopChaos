/**
 * auth/authErrors.ts — turning supabase-js auth errors into messages a person
 * can act on.
 *
 * WHY THIS EXISTS. `@supabase/auth-js` renders **every 5xx from GoTrue as the
 * literal string `"{}"`**. In `handleError` (fetch.js) a status in
 * NETWORK_ERROR_CODES — which includes 500 — short-circuits BEFORE the response
 * body is parsed:
 *
 *     if (NETWORK_ERROR_CODES.includes(error.status)) {
 *       throw new AuthRetryableFetchError(_getErrorMessage(error), error.status)
 *     }
 *
 * `error` there is the raw `Response`, not the parsed body. `_getErrorMessage`
 * looks for `.msg` / `.message` / `.error_description` / `.error`, a `Response`
 * has none of them as strings, and the fallback is `JSON.stringify(err)` —
 * which for a `Response` is `{}`. The server's actual explanation is discarded
 * before anyone can read it.
 *
 * Found 2026-08-27: changing your email showed an error box containing `{}`.
 * The server had in fact returned
 * `{"code":500,"error_code":"unexpected_failure","msg":"Error sending email
 * change email"}` — a perfectly clear message the library threw away.
 *
 * So this is not defensive padding around a hypothetical: it is the ONLY way to
 * say anything useful when GoTrue 5xxes, because the detail is already gone by
 * the time our code sees the error.
 *
 * This affects every auth call in the app, not only the ones using it today —
 * sign-up, sign-in and password reset can all surface `{}` the same way.
 */

/**
 * Messages that carry no information for the user and must be replaced.
 *
 * `{}` is the auth-js 5xx artefact described above. The two fetch failures are
 * what a browser reports when the request never completed at all — a dead
 * gateway, an offline device, or a CORS rejection (which this project has been
 * bitten by twice; a missing preflight once presented as a wrong password).
 */
const OPAQUE_MESSAGES = new Set(['{}', '', 'Failed to fetch', 'Load failed', 'NetworkError'])

/**
 * Produces a message worth showing for a supabase-js auth error.
 *
 * @param error - Whatever the auth call rejected with.
 * @param fallback - What to say when the error carries no usable detail. Write
 *   it to state **what did not happen**, not just that something went wrong —
 *   "your email has not been changed" is actionable, "an error occurred" is not.
 * @returns The server's message when there is one, otherwise `fallback`.
 */
export function authErrorMessage(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const trimmed = raw.trim()
  return OPAQUE_MESSAGES.has(trimmed) ? fallback : trimmed || fallback
}
