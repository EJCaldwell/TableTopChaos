/**
 * DashboardPage — the signed-in landing page ("/").
 *
 * Owns: listing the user's campaigns (with their role in each), creating a new
 * campaign, and joining one by invite code. Replaces the temporary 1.1 home.
 * The role-aware campaign workspace itself lives on CampaignPage (and gets its
 * full tabbed shell in subphase 1.4).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppHeader } from '../../components/AppHeader'
import { Button, FormError, TextField } from '../../components/ui'
import { importCampaign } from '../exportImport/api'
import { ModePicker } from './ModePicker'
import {
  createCampaign,
  joinByCode,
  listMyCampaigns,
  type CampaignWithRole,
  type GameMode,
} from './api'

export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [campaigns, setCampaigns] = useState<CampaignWithRole[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  // Create-campaign form state.
  const [newName, setNewName] = useState('')
  // Which game mode the new campaign starts in. Defaults to 'notetaker' so the
  // create form matches the column default in migration 0028; the DM can switch
  // at any time later from the Overview tab.
  const [newMode, setNewMode] = useState<GameMode>('notetaker')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Join-by-code form state.
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  // Import-campaign state: the chosen .zip awaiting confirmation, and status.
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  /** (Re)loads the campaign list for the current user. */
  const refresh = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setListError(null)
    try {
      setCampaigns(await listMyCampaigns(user.id))
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to load campaigns.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Creates a campaign then navigates straight into it. */
  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!user) return
    setCreateError(null)
    setCreating(true)
    try {
      const campaign = await createCampaign(user.id, newName, newMode)
      setNewName('')
      setNewMode('notetaker')
      navigate(`/campaigns/${campaign.id}`, { state: { openOverview: true } })
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create campaign.')
    } finally {
      setCreating(false)
    }
  }

  /** Imports the chosen .zip as a brand-new campaign, then navigates into it. */
  async function handleImport() {
    if (!importFile) return
    setImportError(null)
    setImporting(true)
    try {
      const result = await importCampaign(importFile)
      setImportFile(null)
      navigate(`/campaigns/${result.campaignId}`, { state: { openOverview: true } })
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not import campaign.')
    } finally {
      setImporting(false)
    }
  }

  /** Redeems an invite code then navigates into the joined campaign. */
  async function handleJoin(e: FormEvent) {
    e.preventDefault()
    setJoinError(null)
    setJoining(true)
    try {
      const campaignId = await joinByCode(code)
      setCode('')
      navigate(`/campaigns/${campaignId}`, { state: { openOverview: true } })
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Could not join campaign.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <>
      <AppHeader />
      <main style={{ maxWidth: 760, margin: '0 auto', padding: 'var(--space-8)' }}>
        <h1>Your campaigns</h1>

        {/* Campaign list */}
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
        ) : listError ? (
          <FormError message={listError} />
        ) : campaigns.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>
            No campaigns yet. Create one below, or join with an invite code.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
            {campaigns.map(({ campaign, role }) => (
              <li key={campaign.id}>
                <button
                  onClick={() => navigate(`/campaigns/${campaign.id}`, { state: { openOverview: true } })}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    cursor: 'pointer',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--space-4)',
                    font: 'inherit',
                    color: 'inherit',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{campaign.name}</span>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: role === 'dm' ? 'var(--color-accent)' : 'var(--color-text-muted)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)',
                      padding: '2px 8px',
                    }}
                  >
                    {role === 'dm' ? 'DM' : 'Player'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Create + join forms, side by side on wide screens. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'var(--space-6)',
            marginTop: 'var(--space-8)',
          }}
        >
          <section
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              padding: 'var(--space-6)',
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Create a campaign</h2>
            <form onSubmit={handleCreate} style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <TextField
                label="Campaign name"
                value={newName}
                required
                maxLength={120}
                placeholder="e.g. Curse of Strahd"
                onChange={(e) => setNewName(e.target.value)}
              />
              <ModePicker
                value={newMode}
                onChange={setNewMode}
                disabled={creating}
                name="new-campaign-mode"
                label="How will this campaign play?"
              />
              <FormError message={createError} />
              <Button type="submit" busy={creating}>
                Create (you'll be the DM)
              </Button>
            </form>

            {/* Import an exported campaign ZIP → creates a brand-new campaign. */}
            <div style={{ marginTop: 'var(--space-6)', paddingTop: 'var(--space-6)', borderTop: '1px solid var(--color-border)' }}>
              <h3 style={{ margin: '0 0 var(--space-3)', fontSize: '0.95rem' }}>Import from a backup</h3>
              <input
                ref={importInputRef}
                type="file"
                accept=".zip,application/zip"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  e.target.value = ''
                  setImportError(null)
                  if (f) setImportFile(f)
                }}
              />
              <FormError message={importError} />
              {importFile ? (
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem' }}>{importFile.name}</span>
                  <Button style={{ width: 'auto' }} busy={importing} onClick={handleImport}>
                    Import as new campaign
                  </Button>
                  <Button variant="secondary" style={{ width: 'auto' }} disabled={importing} onClick={() => setImportFile(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" style={{ width: 'auto' }} onClick={() => importInputRef.current?.click()}>
                  Choose a .zip to import…
                </Button>
              )}
              <p style={{ margin: 'var(--space-3) 0 0', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                Upload a campaign <code>.zip</code> you exported before. It creates a
                brand-new campaign — it never changes an existing one.
              </p>
            </div>
          </section>

          <section
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              padding: 'var(--space-6)',
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Join with a code</h2>
            <form onSubmit={handleJoin} style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <TextField
                label="Invite code"
                value={code}
                required
                placeholder="e.g. K7QMP2XY"
                style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}
                onChange={(e) => setCode(e.target.value)}
              />
              <FormError message={joinError} />
              <Button type="submit" busy={joining}>
                Join campaign
              </Button>
            </form>
          </section>
        </div>
      </main>
    </>
  )
}
