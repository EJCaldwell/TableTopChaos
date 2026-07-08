/**
 * _shared/config.ts — environment + billing configuration for the Edge
 * Functions (Deno runtime).
 *
 * Owns: reading secrets/config from the function environment and mapping the
 * three billing intervals to their Stripe price IDs. Secrets (Stripe keys) MUST
 * come from the environment and are never hardcoded. Price IDs are NOT secret,
 * so the current TEST-mode IDs are baked in as defaults for convenience and can
 * be overridden per environment via env vars when moving to live mode.
 *
 * Required function secrets (set with `supabase secrets set …`):
 *   - STRIPE_SECRET_KEY               — Stripe API secret (sk_test_… / sk_live_…)
 *   - STRIPE_WEBHOOK_SIGNING_SECRET   — from the Stripe webhook endpoint (whsec_…)
 * Auto-injected by the Supabase Edge runtime (do not set manually):
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
 * Optional:
 *   - APP_URL                         — SPA origin for Checkout return URLs
 *   - STRIPE_PRICE_MONTHLY / _SEMIANNUAL / _ANNUAL — override the price IDs
 *   - TRIAL_PERIOD_DAYS               — trial length (default 30)
 */

/** The three billing intervals stored on campaign_subscriptions.interval. */
export type BillingInterval = 'monthly' | 'semiannual' | 'annual'

/**
 * Reads a required env var or throws — used for secrets that have no safe
 * default so a misconfigured deploy fails loudly instead of silently.
 * @param key - The environment variable name.
 */
export function requireEnv(key: string): string {
  const value = Deno.env.get(key)
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

/**
 * Maps each billing interval to its Stripe price ID. TEST-mode IDs are the
 * defaults; override via env for live mode. Values provided by the project
 * owner (test mode): monthly $9.99, semi-annual $49.99, annual $79.99.
 */
export const PRICE_BY_INTERVAL: Record<BillingInterval, string> = {
  monthly:
    Deno.env.get('STRIPE_PRICE_MONTHLY') ?? 'price_1ToREsBSKnRfOSGBJWfz5A7R',
  semiannual:
    Deno.env.get('STRIPE_PRICE_SEMIANNUAL') ?? 'price_1ToREsBSKnRfOSGB97dFLEl4',
  annual:
    Deno.env.get('STRIPE_PRICE_ANNUAL') ?? 'price_1ToREsBSKnRfOSGBqJikAgcE',
}

/** Reverse lookup: Stripe price ID → interval, for interpreting webhooks. */
export const INTERVAL_BY_PRICE: Record<string, BillingInterval> = Object.entries(
  PRICE_BY_INTERVAL,
).reduce((acc, [interval, price]) => {
  acc[price] = interval as BillingInterval
  return acc
}, {} as Record<string, BillingInterval>)

/** Trial length in days (tunable via env; defaults to the planned 30). */
export const TRIAL_PERIOD_DAYS = Number(
  Deno.env.get('TRIAL_PERIOD_DAYS') ?? '30',
)

/** SPA origin used to build Checkout/portal return URLs. */
export const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173'

/** True when the interval string is one of the three known intervals. */
export function isBillingInterval(v: unknown): v is BillingInterval {
  return v === 'monthly' || v === 'semiannual' || v === 'annual'
}
