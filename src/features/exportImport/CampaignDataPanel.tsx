/**
 * CampaignDataPanel — the DM's "Backup & data" control (Phase 4.2.2), rendered in
 * the campaign Settings tab. Export only: download the whole campaign as a ZIP
 * (works even when the campaign is read-only / pending deletion; that's the point
 * of a backup).
 *
 * Import deliberately does NOT live here. Importing always creates a BRAND-NEW
 * campaign rather than touching the one you're looking at, so it belongs to the
 * dashboard (see DashboardPage) — offering it inside a specific campaign's
 * settings implied it would overwrite that campaign.
 */
import { useState } from 'react'
import { Button, FormError } from '../../components/ui'
import { exportCampaign } from './api'

/**
 * @param campaignId - The campaign to export.
 * @param campaignName - Shown in the UI and used to name the export file.
 */
export function CampaignDataPanel({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * Downloads the campaign ZIP via the `export-campaign` Edge Function.
   * Surfaces failures inline; never throws to the caller.
   */
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

  return (
    <section style={{ marginTop: 'var(--space-8)' }}>
      <h2 style={{ fontSize: '1.1rem' }}>Backup &amp; data</h2>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
        Download this campaign as a ZIP for safekeeping. To restore one, use
        “Import a campaign” on the dashboard — it always creates a new campaign.
      </p>

      <FormError message={error} />
      {notice && <p style={{ color: 'var(--color-accent)', fontSize: '0.85rem' }}>{notice}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
        <Button style={{ width: 'auto' }} busy={exporting} onClick={handleExport}>
          Export campaign (.zip)
        </Button>
      </div>
    </section>
  )
}
