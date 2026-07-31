/**
 * CampaignDataPanel — the DM's "Backup & data" controls (Phase 4.2.2), rendered
 * inside the campaign Overview for DMs. Two actions:
 *   * Export — download the whole campaign as a ZIP (works even when the
 *     campaign is read-only / pending deletion; that's the point of a backup).
 *   * Import — upload a previously-exported ZIP to create a BRAND-NEW campaign
 *     (never overwrites this or any other campaign); on success, offer to open
 *     the new campaign.
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, FormError } from '../../components/ui'
import { exportCampaign, importCampaign, type ImportResult } from './api'

/**
 * @param campaignId - The campaign to export.
 * @param campaignName - Shown in the UI and used to name the export file.
 */
export function CampaignDataPanel({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // The file the DM picked, awaiting confirmation before we import it.
  const [pending, setPending] = useState<File | null>(null)
  // The result of a completed import (offer to open the new campaign).
  const [done, setDone] = useState<ImportResult | null>(null)

  /** Downloads the campaign ZIP. */
  async function handleExport() {
    setError(null)
    setNotice(null)
    setExporting(true)
    try {
      await exportCampaign(campaignId, campaignName)
      setNotice('Export downloaded.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  /** Runs the import for the pending file, then shows the summary. */
  async function handleConfirmImport() {
    if (!pending) return
    setError(null)
    setNotice(null)
    setImporting(true)
    try {
      const result = await importCampaign(pending)
      setDone(result)
      setPending(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  const counts = done?.counts

  return (
    <section style={{ marginTop: 'var(--space-8)' }}>
      <h2 style={{ fontSize: '1.1rem' }}>Backup &amp; data</h2>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
        Download this campaign as a ZIP for safekeeping, or import a ZIP to create
        a new campaign from a backup. Importing always creates a brand-new
        campaign — it never changes this one.
      </p>

      <FormError message={error} />
      {notice && <p style={{ color: 'var(--color-accent)', fontSize: '0.85rem' }}>{notice}</p>}

      {/* Export. */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
        <Button style={{ width: 'auto' }} busy={exporting} onClick={handleExport}>
          Export campaign (.zip)
        </Button>
      </div>

      {/* Import. */}
      <div style={{ marginTop: 'var(--space-5)' }}>
        <h3 style={{ fontSize: '1rem', margin: '0 0 var(--space-2)' }}>Import a campaign</h3>

        {done ? (
          // Post-import summary + open action.
          <div style={{ border: '1px solid var(--color-accent)', borderRadius: 'var(--radius)', padding: 'var(--space-4)' }}>
            <p style={{ margin: '0 0 var(--space-2)' }}>Imported a new campaign.</p>
            {counts && (
              <ul style={{ margin: '0 0 var(--space-3)', paddingLeft: '1.2em', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                <li>{counts.characters ?? 0} characters, {counts.journalEntries ?? 0} journal entries</li>
                <li>{counts.npcs ?? 0} NPCs, {counts.encounters ?? 0} encounters, {counts.quests ?? 0} quests</li>
                <li>{counts.sessions ?? 0} sessions, {counts.sharedItems ?? 0} shared items, {counts.imageFiles ?? 0} images</li>
              </ul>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Button style={{ width: 'auto' }} onClick={() => navigate(`/campaigns/${done.campaignId}`)}>
                Open the new campaign
              </Button>
              <Button variant="secondary" style={{ width: 'auto' }} onClick={() => setDone(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : pending ? (
          // Confirm step: the DM picked a file; confirm before importing.
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-4)' }}>
            <p style={{ margin: '0 0 var(--space-3)', fontSize: '0.9rem' }}>
              Import <strong>{pending.name}</strong> as a new campaign?
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Button style={{ width: 'auto' }} busy={importing} onClick={handleConfirmImport}>
                Import as new campaign
              </Button>
              <Button variant="secondary" style={{ width: 'auto' }} disabled={importing} onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                e.target.value = '' // allow re-selecting the same file later
                setError(null)
                setNotice(null)
                if (f) setPending(f)
              }}
            />
            <Button variant="secondary" style={{ width: 'auto' }} onClick={() => fileRef.current?.click()}>
              Choose a .zip to import…
            </Button>
          </>
        )}
      </div>
    </section>
  )
}
