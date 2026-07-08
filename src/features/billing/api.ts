/**
 * billing/api.ts — typed data-access + Edge Function calls for Phase 1.5
 * monetization.
 *
 * Owns: reading a campaign's subscription row (RLS: DM-only) and invoking the
 * three billing Edge Functions. Card data never passes through here — Checkout
 * and the billing portal are hosted by Stripe.
 */
import { supabase } from '../../lib/supabase'
import type { Database } from '../../lib/database.types'

/** A campaign_subscriptions row (mirrors the Stripe subscription). */
export type CampaignSubscription =
  Database['public']['Tables']['campaign_subscriptions']['Row']

/** The three billing intervals. Mirrors the DB check constraint. */
export type BillingInterval = 'monthly' | 'semiannual' | 'annual'

/**
 * Static display pricing for the interval selector. Prices are the live Stripe
 * prices ($X.99); the "save" figures are derived vs. the monthly effective rate
 * ($9.99/mo). The actual charge is always whatever Stripe has for the price ID —
 * these strings are display only.
 */
export const PLAN_PRICING: Record<
  BillingInterval,
  { label: string; price: string; cadence: string; effective: string; save: string | null }
> = {
  monthly: { label: 'Monthly', price: '$9.99', cadence: 'per month', effective: '$9.99/mo', save: null },
  semiannual: { label: '6 months', price: '$49.99', cadence: 'every 6 months', effective: '~$8.33/mo', save: 'Save ~17%' },
  annual: { label: 'Annual', price: '$79.99', cadence: 'per year', effective: '~$6.67/mo', save: 'Save ~33%' },
}

/**
 * Reads the subscription row for a campaign.
 *
 * Supabase call: select from `campaign_subscriptions` by campaign_id.
 *  - RLS: campaign_subscriptions_select_dm — only the campaign's DM sees a row;
 *    everyone else gets null (so this doubles as "am I entitled to see billing").
 * @returns The subscription row, or null if none exists / not visible.
 */
export async function getSubscription(
  campaignId: string,
): Promise<CampaignSubscription | null> {
  const { data, error } = await supabase
    .from('campaign_subscriptions')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Starts Stripe Checkout for a campaign and returns the redirect URL.
 *
 * Edge Function: `create-checkout-session`
 *   (POST { campaignId, interval, startTrial }).
 *  - Requires the caller's JWT (sent automatically by supabase-js) and that they
 *    own the campaign; returns { url } to redirect the browser to.
 * @param campaignId - The campaign to subscribe.
 * @param interval - Billing interval (monthly/semiannual/annual).
 * @param startTrial - true to begin the 30-day free trial (only honored if the
 *   campaign is trial-eligible), false to subscribe with immediate billing.
 * @returns The Stripe Checkout URL.
 */
export async function startCheckout(
  campaignId: string,
  interval: BillingInterval,
  startTrial: boolean,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>(
    'create-checkout-session',
    { body: { campaignId, interval, startTrial } },
  )
  if (error) throw error
  if (!data?.url) throw new Error('Checkout could not be started.')
  return data.url
}

/**
 * Opens the Stripe billing portal for a campaign and returns the redirect URL.
 *
 * Edge Function: `create-billing-portal-session` (POST { campaignId }).
 *  - Owner-only; requires an existing Stripe customer (i.e. a prior checkout).
 * @returns The Stripe billing portal URL.
 */
export async function openBillingPortal(campaignId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>(
    'create-billing-portal-session',
    { body: { campaignId } },
  )
  if (error) throw error
  if (!data?.url) throw new Error('Billing portal could not be opened.')
  return data.url
}
