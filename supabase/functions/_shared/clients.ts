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
    requireEnv('SUPABASE_URL'),
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
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_ANON_KEY'),
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    },
  )
}
