/**
 * import-campaign — Phase 4.2.1: DM data-portability import.
 *
 * Contract (called via supabase.functions.invoke with FormData):
 *   POST multipart/form-data { file: <campaign .zip from export-campaign> }
 *   → 200 { campaignId: string, counts } — the id of the BRAND-NEW campaign.
 *   → 4xx { error } — not signed in / bad or unsupported archive.
 *
 * Guarantees (see PLANNING 4.2):
 *   * ALWAYS creates a NEW campaign owned by the importer — never modifies,
 *     merges into, or overwrites any existing campaign. There is no overwrite
 *     path at all.
 *   * New ids everywhere; the export's ids are used only to rebuild the
 *     relational graph in-memory (old id → new id maps). Images are re-uploaded
 *     to fresh Storage paths and every reference rewritten.
 *   * Transactional-ish: on ANY failure the partially-built campaign is deleted
 *     (cascades remove all children) and any uploaded Storage objects removed —
 *     a failed import leaves nothing behind.
 *   * Original members are NOT recreated as auth users (we can't); the importer
 *     becomes the sole DM. Imported characters are re-owned by the importer so
 *     the campaign is fully usable as a personal restore/backup.
 *
 * Billing note: the new campaign starts with no subscription, exactly like any
 * freshly created campaign — the DM subscribes/trials through the normal billing
 * flow (subject to the one-trial-per-card rule enforced there). Import itself
 * grants no entitlement, so there's nothing to special-case here.
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

/** Highest export schema version this importer understands (v2 adds
 *  character_status + schedule_sessions). */
const MAX_SCHEMA_VERSION = 2

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  // Tracked for rollback if anything throws after we start writing.
  const svc = serviceClient()
  let newCampaignId: string | null = null
  const uploadedPaths: string[] = []

  try {
    // --- AuthN ---
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: userData, error: userErr } = await userClient(authHeader).auth.getUser()
    if (userErr || !userData.user) return jsonResponse({ error: 'Not signed in.' }, 401)
    const userId = userData.user.id

    // --- Read the uploaded ZIP ---
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return jsonResponse({ error: 'No file uploaded.' }, 400)

    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(await file.arrayBuffer())
    } catch {
      return jsonResponse({ error: 'That file is not a valid ZIP archive.' }, 400)
    }

    const manifestRaw = await zip.file('manifest.json')?.async('string')
    const campaignRaw = await zip.file('campaign.json')?.async('string')
    if (!manifestRaw || !campaignRaw) {
      return jsonResponse({ error: 'Archive is missing manifest.json or campaign.json.' }, 400)
    }

    const manifest = JSON.parse(manifestRaw)
    if (typeof manifest.schemaVersion !== 'number' || manifest.schemaVersion > MAX_SCHEMA_VERSION) {
      return jsonResponse(
        { error: `Unsupported export version (${manifest.schemaVersion}). Update the app and try again.` },
        400,
      )
    }

    // Integrity: the manifest's sha256 must match campaign.json as-shipped.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(campaignRaw))
    const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    if (manifest.campaignJsonSha256 && manifest.campaignJsonSha256 !== sha) {
      return jsonResponse({ error: 'Archive is corrupt (checksum mismatch).' }, 400)
    }

    const data = JSON.parse(campaignRaw)

    // --- Create the NEW campaign (owned by the importer) ---
    const importedName = `${data.campaign?.name ?? 'Imported campaign'} (imported)`.slice(0, 200)
    const { data: created, error: createErr } = await svc
      .from('campaigns')
      .insert({ owner_id: userId, name: importedName })
      .select()
      .single()
    if (createErr) throw createErr
    newCampaignId = created.id

    // Importer becomes the sole DM member. Creating the campaign already
    // auto-adds the owner as a 'dm' member (DB trigger), so upsert-ignore the
    // duplicate rather than colliding on the (campaign_id, user_id) unique key.
    const { error: memErr } = await svc
      .from('campaign_members')
      .upsert({ campaign_id: newCampaignId, user_id: userId, role: 'dm' }, {
        onConflict: 'campaign_id,user_id',
        ignoreDuplicates: true,
      })
    if (memErr) throw memErr

    // ---- id-remap helpers ----
    /** Builds an old-id → new-uuid map for a set of exported rows. */
    const idMap = (rows: { id: string }[]) =>
      new Map(rows.map((r) => [r.id, crypto.randomUUID()] as const))

    /**
     * Produces insert-ready rows: assigns the new id, rewrites parent-FK columns
     * via the given maps (missing/nulled refs become null), and drops any keys
     * not wanted. `extra` overrides/sets fixed columns (e.g. campaign_id).
     */
    const remap = (
      rows: Record<string, unknown>[],
      selfMap: Map<string, string>,
      fkMaps: Record<string, Map<string, string | null>>,
      extra: Record<string, unknown> = {},
    ) =>
      rows.map((row) => {
        const out: Record<string, unknown> = { ...row, id: selfMap.get(row.id as string), ...extra }
        for (const [col, map] of Object.entries(fkMaps)) {
          const oldVal = row[col] as string | null
          out[col] = oldVal ? (map.get(oldVal) ?? null) : null
        }
        return out
      })

    /** Inserts rows in one batch (no-op when empty). */
    const insert = async (table: string, rows: Record<string, unknown>[]) => {
      if (rows.length === 0) return
      const { error } = await svc.from(table).insert(rows)
      if (error) throw error
    }

    // ---- Re-upload images, build asset map (old id → new id | null) ----
    const assetMap = new Map<string, string | null>()
    for (const asset of (data.media_assets ?? []) as Record<string, unknown>[]) {
      const oldId = asset.id as string
      const origPath = asset.storage_path as string
      const origBytes = await zip.file(`images/${origPath}`)?.async('uint8array')
      if (!origBytes) {
        // Image bytes absent from the archive → drop the asset; refs become null.
        assetMap.set(oldId, null)
        continue
      }
      const newId = crypto.randomUUID()
      const mime = (asset.mime as string) || 'image/webp'
      const ext = origPath.split('.').pop() || 'webp'
      const newOrig = `${newCampaignId}/${newId}/original.${ext}`
      const up1 = await svc.storage.from('media').upload(newOrig, origBytes, { contentType: mime, upsert: false })
      if (up1.error) throw up1.error
      uploadedPaths.push(newOrig)

      // Thumb is optional; re-upload if present in the archive.
      let newThumb: string | null = null
      const oldThumb = asset.thumb_path as string | null
      if (oldThumb) {
        const thumbBytes = await zip.file(`images/${oldThumb}`)?.async('uint8array')
        if (thumbBytes) {
          const tExt = oldThumb.split('.').pop() || 'webp'
          newThumb = `${newCampaignId}/${newId}/thumb.${tExt}`
          const up2 = await svc.storage.from('media').upload(newThumb, thumbBytes, { contentType: mime, upsert: false })
          if (up2.error) throw up2.error
          uploadedPaths.push(newThumb)
        }
      }

      const { error: insErr } = await svc.from('media_assets').insert({
        id: newId,
        campaign_id: newCampaignId,
        uploaded_by: userId,
        storage_path: newOrig,
        thumb_path: newThumb,
        mime,
        byte_size: asset.byte_size ?? origBytes.byteLength,
        width: asset.width ?? null,
        height: asset.height ?? null,
        original_filename: asset.original_filename ?? null,
        moderation_status: asset.moderation_status ?? 'approved',
      })
      if (insErr) throw insErr
      assetMap.set(oldId, newId)
    }

    // ---- Characters + their children ----
    const charMap = idMap((data.characters ?? []) as { id: string }[])
    await insert(
      'characters',
      remap(data.characters ?? [], charMap, { portrait_asset_id: assetMap }, {
        campaign_id: newCampaignId,
        owner_id: userId, // re-own to the importer
      }),
    )
    const sheetSecMap = idMap((data.sheet_sections ?? []) as { id: string }[])
    await insert('sheet_sections', remap(data.sheet_sections ?? [], sheetSecMap, { character_id: charMap }))
    const sheetFieldMap = idMap((data.sheet_fields ?? []) as { id: string }[])
    await insert('sheet_fields', remap(data.sheet_fields ?? [], sheetFieldMap, { section_id: sheetSecMap }))
    await insert('inventory_items', remap(data.inventory_items ?? [], idMap((data.inventory_items ?? []) as { id: string }[]), { character_id: charMap }))
    await insert('abilities', remap(data.abilities ?? [], idMap((data.abilities ?? []) as { id: string }[]), { character_id: charMap }))
    await insert('spells', remap(data.spells ?? [], idMap((data.spells ?? []) as { id: string }[]), { character_id: charMap }))
    await insert('journal_entries', remap(data.journal_entries ?? [], idMap((data.journal_entries ?? []) as { id: string }[]), { character_id: charMap }))

    // ---- NPCs + stat blocks ----
    const npcMap = idMap((data.npcs ?? []) as { id: string }[])
    await insert('npcs', remap(data.npcs ?? [], npcMap, { portrait_asset_id: assetMap }, { campaign_id: newCampaignId }))
    const npcSecMap = idMap((data.npc_stat_sections ?? []) as { id: string }[])
    await insert('npc_stat_sections', remap(data.npc_stat_sections ?? [], npcSecMap, { npc_id: npcMap }))
    await insert('npc_stat_fields', remap(data.npc_stat_fields ?? [], idMap((data.npc_stat_fields ?? []) as { id: string }[]), { section_id: npcSecMap }))

    // ---- Encounters + links ----
    const encMap = idMap((data.encounters ?? []) as { id: string }[])
    await insert('encounters', remap(data.encounters ?? [], encMap, {}, { campaign_id: newCampaignId }))
    await insert('encounter_images', remap(data.encounter_images ?? [], idMap((data.encounter_images ?? []) as { id: string }[]), { encounter_id: encMap, asset_id: assetMap }))
    await insert('encounter_npcs', remap(data.encounter_npcs ?? [], idMap((data.encounter_npcs ?? []) as { id: string }[]), { encounter_id: encMap, npc_id: npcMap }))

    // ---- Flat campaign-scoped tables ----
    await insert('quests', remap(data.quests ?? [], idMap((data.quests ?? []) as { id: string }[]), {}, { campaign_id: newCampaignId }))
    await insert('dm_notes', remap(data.dm_notes ?? [], idMap((data.dm_notes ?? []) as { id: string }[]), {}, { campaign_id: newCampaignId }))
    await insert('sessions', remap(data.sessions ?? [], idMap((data.sessions ?? []) as { id: string }[]), {}, { campaign_id: newCampaignId }))
    await insert('shared_items', remap(data.shared_items ?? [], idMap((data.shared_items ?? []) as { id: string }[]), { asset_id: assetMap }, { campaign_id: newCampaignId }))
    await insert('initiative_entries', remap(data.initiative_entries ?? [], idMap((data.initiative_entries ?? []) as { id: string }[]), { npc_id: npcMap }, { campaign_id: newCampaignId }))

    // ---- v2 tables ----
    // character_status: PK is character_id (no surrogate id) — remap that FK only.
    const statusRows = ((data.character_status ?? []) as Record<string, unknown>[])
      .map((r) => ({ ...r, character_id: charMap.get(r.character_id as string) }))
      .filter((r) => r.character_id)
    await insert('character_status', statusRows)
    // schedule_sessions: DM-proposed dates carry over. schedule_rsvps are
    // intentionally NOT imported — they're per-user availability tied to specific
    // accounts who aren't members of this fresh copy, so a restored RSVP would be
    // meaningless (and could dangle if that account is gone).
    const schedMap = idMap((data.schedule_sessions ?? []) as { id: string }[])
    await insert('schedule_sessions', remap(data.schedule_sessions ?? [], schedMap, {}, { campaign_id: newCampaignId }))

    return jsonResponse({ campaignId: newCampaignId, counts: manifest.counts ?? null }, 200)
  } catch (err) {
    // --- Rollback: remove the half-built campaign + any uploaded objects. ---
    await rollback(svc, newCampaignId, uploadedPaths)
    return jsonResponse({ error: errorMessage(err) }, 500)
  }
})

/**
 * Extracts a human message from any thrown value. Supabase/PostgREST errors are
 * plain OBJECTS (not Error instances), so `instanceof Error` misses them; pull
 * message/details/hint/code when present.
 * @param err - The caught value.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    const parts = [e.message, e.details, e.hint, e.code].filter(Boolean)
    if (parts.length) return parts.join(' | ')
    try { return JSON.stringify(err) } catch { /* ignore */ }
  }
  return 'Import failed.'
}

/**
 * Best-effort cleanup after a failed import: deletes the new campaign (its rows
 * cascade) and any Storage objects we uploaded. Never throws — cleanup failures
 * shouldn't mask the original error.
 * @param svc - Service-role client.
 * @param campaignId - The new campaign to delete (if it was created).
 * @param paths - Storage object paths uploaded during this import.
 */
async function rollback(svc: SupabaseClient, campaignId: string | null, paths: string[]) {
  try {
    if (paths.length) await svc.storage.from('media').remove(paths)
  } catch { /* ignore */ }
  try {
    if (campaignId) await svc.from('campaigns').delete().eq('id', campaignId)
  } catch { /* ignore */ }
}
