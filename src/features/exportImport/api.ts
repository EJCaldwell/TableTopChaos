/**
 * exportImport/api.ts — client wrappers for the Phase 4.2 data-portability Edge
 * Functions: full-campaign export (DM), campaign import (DM), and per-player
 * journal export (any member). Each wraps supabase.functions.invoke, surfaces
 * the function's JSON { error } message on failure, and (for exports) triggers a
 * browser download of the returned file(s).
 */
import { supabase } from '../../lib/supabase'

/** Manifest counts echoed back by import-campaign (all optional/defensive). */
export interface ImportCounts {
  members?: number
  characters?: number
  npcs?: number
  encounters?: number
  quests?: number
  sessions?: number
  sharedItems?: number
  journalEntries?: number
  mediaAssets?: number
  imageFiles?: number
}

/** Result of a successful import: the new campaign id + what was created. */
export interface ImportResult {
  campaignId: string
  counts: ImportCounts | null
}

/**
 * Pulls the function's JSON { error } message off a failed invoke (supabase-js
 * exposes the raw Response on error.context), falling back to the generic text.
 * @param error - The FunctionsError from invoke.
 */
async function messageFromError(error: unknown): Promise<string> {
  const base = error instanceof Error ? error.message : 'Request failed.'
  try {
    const body = await (error as { context?: Response }).context?.json?.()
    if (body && typeof body.error === 'string') return body.error
  } catch {
    /* fall through to base */
  }
  return base
}

/** Triggers a browser download of a Blob under `filename`. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Exports a whole campaign to a ZIP and downloads it (DM only — the function
 * enforces this). invoke returns the zip as a Blob (application/zip response).
 * @param campaignId - The campaign to export.
 * @param campaignName - Used only to name the downloaded file.
 */
export async function exportCampaign(campaignId: string, campaignName: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('export-campaign', {
    body: { campaignId },
  })
  if (error) throw new Error(await messageFromError(error))
  // The function returns the zip as octet-stream (so invoke gives us a Blob);
  // re-label it as application/zip for the download. Guard the unexpected case
  // where invoke handed back text/JSON instead of binary.
  if (!(data instanceof Blob)) throw new Error('Export did not return a file.')
  const blob = new Blob([data], { type: 'application/zip' })
  const safe = campaignName.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) || 'campaign'
  downloadBlob(blob, `${safe}.zip`)
}

/**
 * Imports a campaign ZIP, creating a BRAND-NEW campaign owned by the caller.
 * Never touches existing campaigns.
 * @param file - The .zip produced by exportCampaign.
 * @returns The new campaign id + counts of what was created.
 */
export async function importCampaign(file: File): Promise<ImportResult> {
  const form = new FormData()
  form.append('file', file)
  const { data, error } = await supabase.functions.invoke<ImportResult>('import-campaign', {
    body: form,
  })
  if (error) throw new Error(await messageFromError(error))
  if (!data?.campaignId) throw new Error('Import did not return a campaign id.')
  return data
}

/**
 * Exports the caller's OWN journal for a campaign and downloads it as both JSON
 * and Markdown. Scoped server-side to the caller (RLS) — never another player's.
 * @param campaignId - The campaign whose journal to export.
 */
export async function exportMyJournal(campaignId: string): Promise<{ count: number }> {
  const { data, error } = await supabase.functions.invoke<{
    characterName: string | null
    entries: unknown[]
    markdown: string
  }>('export-journal', { body: { campaignId } })
  if (error) throw new Error(await messageFromError(error))
  if (!data) throw new Error('Journal export failed.')

  const safe = (data.characterName || 'journal').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) || 'journal'
  downloadBlob(new Blob([JSON.stringify(data.entries, null, 2)], { type: 'application/json' }), `${safe}-journal.json`)
  downloadBlob(new Blob([data.markdown], { type: 'text/markdown' }), `${safe}-journal.md`)
  return { count: data.entries.length }
}
