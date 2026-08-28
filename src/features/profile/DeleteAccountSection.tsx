/**
 * DeleteAccountSection — the "delete my account" danger zone (Phase 7.1.2).
 *
 * Lives on the Profile page under Account. Split into its own file because it is
 * the only irreversible action in the app that affects OTHER people's data: a DM
 * deleting their account destroys their campaigns for every member of them.
 *
 * Three deliberate design choices:
 *
 *  1. **The preview is fetched before the confirm control is shown.** A generic
 *     "this cannot be undone" warning does not tell a DM that four other people
 *     lose a year of session notes. The preview names each campaign and how many
 *     members it has, so the blast radius is concrete at the moment of deciding.
 *
 *  2. **Type-your-email to confirm**, not a second "are you sure" button. Email
 *     rather than the username: the username is now unique and required (0039),
 *     so it would work as a token — but it is also the thing shown to everyone
 *     in your campaigns, so it is the string a bystander is most likely to know
 *     and the least likely to make anyone pause. The email is private, and
 *     typing it is a moment of deliberation. The Edge Function re-checks it
 *     server-side; this is a guard against mistakes, not a security boundary.
 *
 *  3. **Export is offered first, not mentioned afterwards.** By the time someone
 *     reads a warning they have usually decided; the export link has to be in
 *     front of them before the confirm field, or it may as well not exist.
 *
 * There is no grace period and no soft delete — deletion is immediate and
 * unrecoverable, which is what keeps a `deleted_at` predicate out of the RLS
 * policies on all 29 tables (one missed clause there would leak a "deleted"
 * user's content).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, FormError, TextField } from '../../components/ui'
import { useAuth } from '../auth/AuthProvider'
import { deleteMyAccount, getDeletionPreview, type DeletionPreview } from './accountApi'

/** Renders bytes as a short human string for the preview line. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DeleteAccountSection() {
  const { user, signOut } = useAuth()

  // `preview === null` means "not yet requested" — the section starts collapsed
  // so the Profile page does not open on a wall of red.
  const [preview, setPreview] = useState<DeletionPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Opens the confirmation flow by loading what would actually be destroyed. */
  async function handleBegin() {
    setError(null)
    setLoadingPreview(true)
    try {
      setPreview(await getDeletionPreview())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check your account.')
    } finally {
      setLoadingPreview(false)
    }
  }

  /**
   * Performs the deletion, then signs out.
   *
   * The sign-out is not cosmetic: on success the account no longer exists, so
   * the stored session refers to a deleted user and every subsequent request
   * fails. Signing out is what turns that into a clean return to the login
   * screen rather than an app full of unexplained errors.
   */
  async function handleDelete() {
    setBusy(true)
    setError(null)
    try {
      await deleteMyAccount(confirmation)
      await signOut()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete your account.')
      setBusy(false)
    }
  }

  const emailMatches =
    !!user?.email && confirmation.trim().toLowerCase() === user.email.trim().toLowerCase()

  return (
    <section
      style={{
        marginTop: 'var(--space-8)',
        padding: 'var(--space-6)',
        border: '1px solid var(--color-danger)',
        borderRadius: 'var(--radius)',
      }}
    >
      <h2 style={{ fontSize: '1.1rem', marginTop: 0, color: 'var(--color-danger)' }}>
        Delete your account
      </h2>

      {!preview ? (
        <>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
            Permanently deletes your account and everything in it. Campaigns you
            run are deleted for everyone in them. This cannot be undone.
          </p>
          <FormError message={error} />
          <Button
            variant="secondary"
            style={{ width: 'auto' }}
            busy={loadingPreview}
            onClick={handleBegin}
          >
            Delete my account…
          </Button>
        </>
      ) : (
        <>
          <p style={{ fontSize: '0.9rem', marginTop: 0 }}>
            Here is exactly what will be removed:
          </p>

          {/* Campaigns the user DMs are listed individually with member counts —
              this is the part that affects other people, so it is not summarised
              into a single number. */}
          {preview.dm_campaigns.length > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <strong style={{ fontSize: '0.9rem', color: 'var(--color-danger)' }}>
                {preview.dm_campaigns.length}{' '}
                {preview.dm_campaigns.length === 1 ? 'campaign' : 'campaigns'} you run
                will be deleted for everyone in them:
              </strong>
              <ul style={{ fontSize: '0.85rem', margin: 'var(--space-2) 0 0', paddingLeft: '1.2rem' }}>
                {preview.dm_campaigns.map((c) => (
                  <li key={c.id}>
                    <strong>{c.name}</strong> — {c.member_count}{' '}
                    {c.member_count === 1 ? 'member' : 'members'} lose access
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul style={{ fontSize: '0.85rem', margin: '0 0 var(--space-4)', paddingLeft: '1.2rem' }}>
            <li>
              {preview.character_count}{' '}
              {preview.character_count === 1 ? 'character' : 'characters'}, with their
              sheets, inventory, spells and journals
            </li>
            <li>
              {preview.media_file_count} uploaded{' '}
              {preview.media_file_count === 1 ? 'image' : 'images'} (
              {formatBytes(preview.media_byte_count)})
            </li>
            {preview.player_campaign_count > 0 && (
              <li>
                You leave {preview.player_campaign_count}{' '}
                {preview.player_campaign_count === 1 ? 'campaign' : 'campaigns'} you play
                in — those campaigns are not deleted
              </li>
            )}
            {preview.active_subscription_count > 0 && (
              <li>
                {preview.active_subscription_count} active{' '}
                {preview.active_subscription_count === 1 ? 'subscription' : 'subscriptions'}{' '}
                will be cancelled
              </li>
            )}
          </ul>

          {/* Offered BEFORE the confirm field, deliberately — see the file
              header. Once someone has typed their email they are not going to
              stop and read about backups. */}
          <p style={{ fontSize: '0.85rem' }}>
            <Link to="/">Export your campaigns and journals first →</Link>
          </p>

          <div style={{ display: 'grid', gap: 'var(--space-3)', maxWidth: 340 }}>
            <TextField
              label={`Type ${user?.email ?? 'your email'} to confirm`}
              type="text"
              value={confirmation}
              autoComplete="off"
              onChange={(e) => setConfirmation(e.target.value)}
            />
            <FormError message={error} />
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Button
                style={{ width: 'auto', background: 'var(--color-danger)' }}
                busy={busy}
                // Disabled until the email matches exactly. The server enforces
                // this too; disabling here just avoids a pointless round trip.
                disabled={!emailMatches}
                onClick={handleDelete}
              >
                Permanently delete my account
              </Button>
              <Button
                variant="secondary"
                style={{ width: 'auto' }}
                disabled={busy}
                onClick={() => {
                  setPreview(null)
                  setConfirmation('')
                  setError(null)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
