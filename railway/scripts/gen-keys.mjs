#!/usr/bin/env node
/**
 * gen-keys.mjs — generates the three linked secrets the self-hosted stack needs.
 *
 * Owns: producing a JWT_SECRET plus the ANON_KEY and SERVICE_ROLE_KEY *derived*
 * from it. These are not three independent strings: the two keys are HS256 JWTs
 * signed with JWT_SECRET. GoTrue signs session tokens with the same secret, which
 * is what lets PostgREST verify them and `auth.uid()` resolve inside RLS policies.
 * Generating the keys by hand (or independently) is the most common way to end up
 * with a stack where every request 401s.
 *
 * Usage:
 *   node railway/scripts/gen-keys.mjs             # fresh JWT_SECRET
 *   node railway/scripts/gen-keys.mjs <existing>  # re-derive keys for a known secret
 *
 * Output is printed to stdout in .env form. It is NEVER written to a file — piping
 * secrets into the repo is how they get committed. Paste them into Railway shared
 * variables (and your local .env) yourself.
 *
 * Zero dependencies: uses only node:crypto, so it runs without an install step.
 */
import { createHmac, randomBytes } from 'node:crypto'

/** Ten years in seconds — these keys are long-lived config, not session tokens. */
const TEN_YEARS = 60 * 60 * 24 * 365 * 10

/**
 * Base64url-encodes a Buffer or string (JWT segments use base64url, not base64:
 * `+/` become `-_` and trailing `=` padding is dropped).
 *
 * @param input - Raw bytes or UTF-8 string to encode.
 * @returns The base64url representation.
 */
function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Signs a minimal HS256 JWT carrying a single Postgres role claim.
 *
 * PostgREST reads the `role` claim and issues `set local role <role>` for the
 * request, which is precisely what activates the RLS policies written against
 * `anon` / `authenticated` / `service_role`.
 *
 * @param role - Postgres role name to embed ('anon' or 'service_role').
 * @param secret - The shared JWT_SECRET; must match every service's config.
 * @returns A signed compact-serialization JWT.
 */
function signKey(role, secret) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({ role, iss: 'supabase', iat: issuedAt, exp: issuedAt + TEN_YEARS }),
  )
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest()
  return `${header}.${payload}.${b64url(signature)}`
}

// Accept an existing secret so keys can be re-derived without rotating (and thus
// without invalidating every signed-in session).
const secret = process.argv[2] ?? randomBytes(32).toString('hex')

if (process.argv[2]) {
  console.log('# Re-derived keys for the JWT_SECRET you supplied.\n')
} else {
  console.log('# Fresh JWT_SECRET generated. Store it before continuing —')
  console.log('# rotating it later invalidates both keys AND every live session.\n')
}

console.log(`JWT_SECRET=${secret}`)
console.log(`ANON_KEY=${signKey('anon', secret)}`)
console.log(`SERVICE_ROLE_KEY=${signKey('service_role', secret)}`)
console.log('')
console.log('# Frontend (.env) — note ANON_KEY is public by design; RLS is the guard.')
console.log(`VITE_SUPABASE_ANON_KEY=${signKey('anon', secret)}`)
console.log('# VITE_SUPABASE_URL=https://<your-gateway>.up.railway.app')
console.log('')
console.log('# SERVICE_ROLE_KEY bypasses RLS entirely. Edge Function / Railway')
console.log('# service variables only — never a VITE_ var, never the browser.')
