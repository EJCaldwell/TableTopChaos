/**
 * DashboardPage — the signed-in landing page ("/").
 *
 * Owns: listing the user's campaigns (with their role in each), creating a new
 * campaign, and joining one by invite code. Replaces the temporary 1.1 home.
 * The role-aware campaign workspace itself lives on CampaignPage (and gets its
 * full tabbed shell in subphase 1.4).
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AppHeader } from '../../components/AppHeader'
import { Button, FormError, TextField } from '../../components/ui'
import {
  createCampaign,
  joinByCode,
  listMyCampaigns,
  type CampaignWithRole,
} from './api'

export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [campaigns, setCampaigns] = useState<CampaignWithRole[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  // Create-campaign form state.
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Join-by-code form state.
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

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
      const campaign = await createCampaign(user.id, newName)
      setNewName('')
      navigate(`/campaigns/${campaign.id}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create campaign.')
    } finally {
      setCreating(false)
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
      navigate(`/campaigns/${campaignId}`)
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
                  onClick={() => navigate(`/campaigns/${campaign.id}`)}
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
              <FormError message={createError} />
              <Button type="submit" busy={creating}>
                Create (you'll be the DM)
              </Button>
            </form>
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
