/**
 * _shared/clients.ts — constructs the Stripe and Supabase clients used by the
 * billing Edge Functions (Deno runtime).
 *
 * Two Supabase clients exist by design:
 *   - a SERVICE-ROLE client (bypasses RLS) for privileged reads/writes the
 *     webhook and owner checks need (campaign_subscriptions, trial_redemptions);
 *   - a per-request USER client bound to the caller's JWT, used only to resolve
 *     *who* is calling (auth.getUser) so we never trust a client-supplied id.
 *
 * The Stripe client is configured with the fetch-based HTTP client + SubtleCrypto
 * provider required to run under Deno (the default Node transports aren't
 * available in the Edge runtime).
 */
import Stripe from 'npm:stripe@17.7.0'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.47.10'
import { requireEnv } from './config.ts'

/**
 * The base URL these functions use to reach Supabase's own services.
 *
 * WHY THIS IS NOT SIMPLY SUPABASE_URL. That variable holds the PUBLIC gateway
 * hostname, so every query a function made went out to the internet, back in
 * through Railway's edge, and only then to the gateway — a full public round
 * trip per query, from a container sitting a few milliseconds away from the
 * database on the internal network.
 *
 * Found while asking why the fog took so long to update after a move: the
 * `vision` function makes several queries per request, and each was paying that
 * toll. Setting SUPABASE_INTERNAL_URL to `http://gateway.railway.internal:8000`
 * keeps the traffic inside Railway.
 *
 * Falls back to the public URL when unset, so nothing breaks if the variable is
 * missing — it is a performance setting, not a correctness one. Public URLs used
 * in EMAILS or redirects must keep using APP_URL/SUPABASE_URL: this is only for
 * server-to-server calls, where a hostname nobody outside the network can
 * resolve is exactly what you want.
 */
function supabaseBaseUrl(): string {
  return Deno.env.get('SUPABASE_INTERNAL_URL') ?? requireEnv('SUPABASE_URL')
}

/**
 * A Stripe client wired for Deno. `constructEventAsync` (used in the webhook)
 * needs the SubtleCrypto provider; all HTTP calls use fetch.
 */
export const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
  apiVersion: '2025-06-30.basil',
  httpClient: Stripe.createFetchHttpClient(),
})

/** Crypto provider for async webhook signature verification under Deno. */
export const cryptoProvider = Stripe.createSubtleCryptoProvider()

/**
 * Service-role Supabase client — FULL ACCESS, bypasses RLS. Never expose its key
 * to the browser; it exists only inside these server-side functions.
 */
export function serviceClient(): SupabaseClient {
  return createClient(
    supabaseBaseUrl(),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  )
}

/**
 * A Supabase client bound to the caller's bearer token. Used only to identify
 * the caller (getUser); it respects RLS like any normal signed-in client.
 * @param authHeader - The incoming request's Authorization header.
 */
export function userClient(authHeader: string): SupabaseClient {
  return createClient(
    supabaseBaseUrl(),
    requireEnv('SUPABASE_ANON_KEY'),
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    },
  )
}
