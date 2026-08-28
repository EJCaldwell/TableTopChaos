/**
 * export-campaign — Phase 4.2.1: DM-only full campaign export to a ZIP.
 *
 * Contract (called via supabase.functions.invoke with a JSON body):
 *   POST { campaignId: string }
 *   → 200 application/zip  (a Blob) — the campaign archive:
 *         manifest.json  — schema version, export date, app version, counts,
 *                          + a sha256 of campaign.json for integrity.
 *         campaign.json  — every campaign row (see GATHER below), ids preserved
 *                          so import can rebuild the relational graph. Members
 *                          are recorded as display names + role, NOT auth ids.
 *         images/<storage_path> — the bytes of every referenced media asset
 *                          (original + thumb) pulled from the private `media`
 *                          bucket, so the archive is fully self-contained.
 *   → 4xx { error } — not signed in / not the DM / campaign missing.
 *
 * Export must NEVER be blocked by a read-only / pending-deletion lock — it's the
 * DM's data-portability + pre-deletion safety net — so it uses the service role
 * and does no writability check.
 *
 * Privacy note (decided, see PLANNING 4.2): this export INCLUDES player personal
 * journals. The in-app "DM can't read journals" rule still holds in the UI; the
 * downloadable export is the documented exception.
 */
import JSZip from 'npm:jszip@3.10.1'
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
/** Service-role client — bypasses RLS. Server-side only. */
function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
}
/** Client bound to the caller's JWT — used to identify the caller (getUser). */
function userClient(authHeader: string): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
}

/** Bump when the export shape changes; import validates it can read this.
 *  v2 adds character_status, schedule_sessions, schedule_rsvps. */
const SCHEMA_VERSION = 2
/** App version stamped into the manifest (kept in sync with package.json). */
const APP_VERSION = '0.0.0'

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    // --- AuthN: identify the caller from their bearer token. ---
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: userData, error: userErr } = await userClient(authHeader).auth.getUser()
    if (userErr || !userData.user) return jsonResponse({ error: 'Not signed in.' }, 401)
    const userId = userData.user.id

    const { campaignId } = await req.json().catch(() => ({}))
    if (!campaignId || typeof campaignId !== 'string') {
      return jsonResponse({ error: 'campaignId is required.' }, 400)
    }

    const svc = serviceClient()

    // --- AuthZ: caller must be the DM (owner) of this campaign. ---
    const { data: campaign, error: cErr } = await svc
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .maybeSingle()
    if (cErr) throw cErr
    if (!campaign) return jsonResponse({ error: 'Campaign not found.' }, 404)

    const { data: dmMember } = await svc
      .from('campaign_members')
      .select('role')
      .eq('campaign_id', campaignId)
      .eq('user_id', userId)
      .maybeSingle()
    const isDm = campaign.owner_id === userId || dmMember?.role === 'dm'
    if (!isDm) return jsonResponse({ error: 'Only the DM can export this campaign.' }, 403)

    // --- GATHER: every campaign-scoped row, in relational groups. ---
    // Helper: fetch all rows of a table filtered by a column = value.
    const all = async (table: string, col: string, val: string) => {
      const { data, error } = await svc.from(table).select('*').eq(col, val)
      if (error) throw error
      return data ?? []
    }
    // Helper: fetch child rows whose parent id is IN a set (empty-safe).
    const allIn = async (table: string, col: string, ids: string[]) => {
      if (ids.length === 0) return []
      const { data, error } = await svc.from(table).select('*').in(col, ids)
      if (error) throw error
      return data ?? []
    }

    const members = await all('campaign_members', 'campaign_id', campaignId)
    const characters = await all('characters', 'campaign_id', campaignId)
    const charIds = characters.map((c) => c.id)
    const sheetSections = await allIn('sheet_sections', 'character_id', charIds)
    const sheetFields = await allIn('sheet_fields', 'section_id', sheetSections.map((s) => s.id))
    const inventory = await allIn('inventory_items', 'character_id', charIds)
    const abilities = await allIn('abilities', 'character_id', charIds)
    const spells = await allIn('spells', 'character_id', charIds)
    const journals = await allIn('journal_entries', 'character_id', charIds)

    const npcs = await all('npcs', 'campaign_id', campaignId)
    const npcSections = await allIn('npc_stat_sections', 'npc_id', npcs.map((n) => n.id))
    const npcFields = await allIn('npc_stat_fields', 'section_id', npcSections.map((s) => s.id))

    const encounters = await all('encounters', 'campaign_id', campaignId)
    const encIds = encounters.map((e) => e.id)
    const encounterImages = await allIn('encounter_images', 'encounter_id', encIds)
    const encounterNpcs = await allIn('encounter_npcs', 'encounter_id', encIds)

    const quests = await all('quests', 'campaign_id', campaignId)
    const dmNotes = await all('dm_notes', 'campaign_id', campaignId)
    const sessions = await all('sessions', 'campaign_id', campaignId)
    const sharedItems = await all('shared_items', 'campaign_id', campaignId)
    const initiative = await all('initiative_entries', 'campaign_id', campaignId)
    const mediaAssets = await all('media_assets', 'campaign_id', campaignId)
    // v2 additions.
    const characterStatus = await allIn('character_status', 'character_id', charIds)
    const scheduleSessions = await all('schedule_sessions', 'campaign_id', campaignId)
    const scheduleRsvps = await allIn('schedule_rsvps', 'session_id', scheduleSessions.map((s) => s.id))

    // Resolve member auth ids → usernames (never leak auth identities).
    //
    // The column was renamed display_name → username in migration 0039. The
    // EXPORT KEY stays `display_name` on purpose: archives already downloaded by
    // users contain that key, and import-campaign reads it. Renaming it would
    // silently break every existing archive for the sake of matching a column
    // name that nobody reading a backup can see.
    const profileIds = members.map((m) => m.user_id)
    const { data: profiles } = profileIds.length
      ? await svc.from('profiles').select('id, username').in('id', profileIds)
      : { data: [] as { id: string; username: string }[] }
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.username]))
    const exportedMembers = members.map((m) => ({
      display_name: nameById.get(m.user_id) ?? 'Unknown',
      role: m.role,
    }))

    // --- Build campaign.json (ids preserved for the import remap). ---
    const campaignJson = {
      campaign: { name: campaign.name, created_at: campaign.created_at },
      members: exportedMembers,
      media_assets: mediaAssets,
      characters,
      sheet_sections: sheetSections,
      sheet_fields: sheetFields,
      inventory_items: inventory,
      abilities,
      spells,
      journal_entries: journals,
      npcs,
      npc_stat_sections: npcSections,
      npc_stat_fields: npcFields,
      encounters,
      encounter_images: encounterImages,
      encounter_npcs: encounterNpcs,
      quests,
      dm_notes: dmNotes,
      sessions,
      shared_items: sharedItems,
      initiative_entries: initiative,
      character_status: characterStatus,
      schedule_sessions: scheduleSessions,
      schedule_rsvps: scheduleRsvps,
    }
    const campaignJsonStr = JSON.stringify(campaignJson, null, 2)

    // sha256 of campaign.json for the manifest (integrity check on import).
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(campaignJsonStr))
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')

    // --- Assemble the ZIP. ---
    const zip = new JSZip()
    zip.file('campaign.json', campaignJsonStr)

    // Pull every referenced image (original + thumb) from Storage into images/.
    const imageFiles: string[] = []
    for (const asset of mediaAssets) {
      for (const path of [asset.storage_path, asset.thumb_path].filter(Boolean) as string[]) {
        const { data: blob, error: dlErr } = await svc.storage.from('media').download(path)
        if (dlErr || !blob) continue // skip missing objects; manifest counts note it
        zip.file(`images/${path}`, await blob.arrayBuffer())
        imageFiles.push(path)
      }
    }

    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      campaignName: campaign.name,
      sourceCampaignId: campaignId,
      campaignJsonSha256: sha256,
      counts: {
        members: exportedMembers.length,
        characters: characters.length,
        npcs: npcs.length,
        encounters: encounters.length,
        quests: quests.length,
        sessions: sessions.length,
        sharedItems: sharedItems.length,
        journalEntries: journals.length,
        mediaAssets: mediaAssets.length,
        imageFiles: imageFiles.length,
      },
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 2))

    const zipBuf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })

    // Return the ZIP directly as a binary download (no temp object to clean up).
    const safeName = campaign.name.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) || 'campaign'
    // NOTE: octet-stream (not application/zip) on purpose — supabase-js
    // functions.invoke only returns a Blob for octet-stream; other content
    // types fall back to response.text() and corrupt the binary. The client
    // re-labels the Blob as application/zip when saving.
    return new Response(zipBuf, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeName}.zip"`,
      },
    })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Export failed.' }, 500)
  }
})
