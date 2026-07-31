/**
 * export-journal — Phase 4.2.1: any campaign member downloads THEIR OWN journal.
 *
 * Contract (called via supabase.functions.invoke with a JSON body):
 *   POST { campaignId: string }
 *   → 200 { characterName, entries: [...], markdown: string } — the caller's own
 *          journal entries for that campaign, plus a readable Markdown rendering.
 *          The web client turns this into .json + .md downloads.
 *   → 4xx { error } — not signed in / bad input.
 *
 * Scoping: this uses the caller's USER client, so RLS is the gate — a player can
 * only ever read their own entries (journal_entries select is owner-only, plus a
 * shared-to-DM clause that doesn't apply to a plain member reading their own).
 * The DM uses the exact same endpoint for their own character's journal. Works
 * regardless of a campaign's read-only state (it's a read).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.47.10'

// --- Inline shared helpers (self-contained so the function bundles cleanly) ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
/** 204 for the browser's CORS preflight; null so real requests continue. */
function handlePreflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: corsHeaders }) : null
}
/** JSON response with CORS headers. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
/** Client bound to the caller's JWT — RLS is the gate for journal reads. */
function userClient(authHeader: string): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const uc = userClient(authHeader)
    const { data: userData, error: userErr } = await uc.auth.getUser()
    if (userErr || !userData.user) return jsonResponse({ error: 'Not signed in.' }, 401)
    const userId = userData.user.id

    const { campaignId } = await req.json().catch(() => ({}))
    if (!campaignId || typeof campaignId !== 'string') {
      return jsonResponse({ error: 'campaignId is required.' }, 400)
    }

    // The caller's own characters in this campaign (RLS + explicit owner filter).
    const { data: chars, error: cErr } = await uc
      .from('characters')
      .select('id, name')
      .eq('campaign_id', campaignId)
      .eq('owner_id', userId)
    if (cErr) throw cErr

    const charIds = (chars ?? []).map((c) => c.id)
    if (charIds.length === 0) {
      return jsonResponse({ characterName: null, entries: [], markdown: '# Journal\n\n_No entries._\n' })
    }

    // journal_entries RLS restricts this to the caller's own entries.
    const { data: entries, error: jErr } = await uc
      .from('journal_entries')
      .select('*')
      .in('character_id', charIds)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
    if (jErr) throw jErr

    const characterName = chars?.[0]?.name || 'Character'
    const rows = entries ?? []

    // Build a human-readable Markdown rendering.
    const lines = [`# ${characterName} — Journal`, '']
    for (const e of rows) {
      lines.push(`## ${e.title || 'Untitled entry'}`)
      const date = e.created_at ? new Date(e.created_at).toLocaleDateString() : ''
      if (date) lines.push(`_${date}${e.shared ? ' · shared with DM' : ''}_`, '')
      lines.push(e.body || '', '')
    }
    const markdown = lines.join('\n')

    return jsonResponse({ characterName, entries: rows, markdown })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Journal export failed.' }, 500)
  }
})
