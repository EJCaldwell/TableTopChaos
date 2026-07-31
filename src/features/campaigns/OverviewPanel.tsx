/**
 * OverviewPanel — the "Overview" tab body of the campaign workspace.
 *
 * Owns (extracted from the old flat CampaignPage in 1.4): the member roster
 * (all members), DM-only invite-code management (create/copy/revoke), and the
 * owner-only danger zone (delete campaign). This panel is self-contained: it
 * manages its own invite-code and delete state so the shell (CampaignPage) only
 * has to hand it the campaign, roster, and the caller's role flags.
 *
 * All DM/owner gating here is UI convenience; the real enforcement is RLS
 * (migrations 0003–0004): a player's client cannot read/write invite codes and
 * a non-owner's delete matches zero rows.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, FormError } from '../../components/ui'
import {
  createInviteCode,
  deleteCampaign,
  deleteInviteCode,
  listInviteCodes,
  renameCampaign,
  type Campaign,
  type InviteCode,
  type Member,
} from './api'
import { CampaignDataPanel } from '../exportImport/CampaignDataPanel'

/**
 * @param campaign - The loaded campaign (name, owner_id…).
 * @param members - The full roster (already sorted DMs-first by the shell).
 * @param isDm - Whether the caller is a DM (gates the invite-code section).
 * @param isOwner - Whether the caller owns the campaign (gates the danger zone).
 * @param currentUserId - The caller's auth id, to mark "(you)" and stamp
 *        created_by on new invite codes.
 */
export function OverviewPanel({
  campaign,
  members,
  isDm,
  isOwner,
  currentUserId,
  onRenamed,
}: {
  campaign: Campaign
  members: Member[]
  isDm: boolean
  isOwner: boolean
  currentUserId: string | undefined
  /** Called after a successful rename so the shell can update its header. */
  onRenamed?: (name: string) => void
}) {
  const navigate = useNavigate()

  const [codes, setCodes] = useState<InviteCode[]>([])
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  // Whether the destructive delete confirmation is currently showing.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Campaign rename (DM only): editing flag + the in-progress name draft.
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(campaign.name)
  const [savingName, setSavingName] = useState(false)

  /** DM: persist the renamed campaign, then update the header via onRenamed. */
  async function handleRename() {
    const next = nameDraft.trim()
    if (!next) {
      setError('Campaign name cannot be empty.')
      return
    }
    if (next === campaign.name) {
      setRenaming(false)
      return
    }
    setSavingName(true)
    setError(null)
    try {
      await renameCampaign(campaign.id, next)
      onRenamed?.(next)
      setRenaming(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the campaign.')
    } finally {
      setSavingName(false)
    }
  }

  /**
   * Loads invite codes for DMs. Players are blocked by RLS, so we only attempt
   * the read when the caller is a DM and swallow errors defensively.
   */
  const loadCodes = useCallback(async () => {
    if (!isDm) return
    try {
      setCodes(await listInviteCodes(campaign.id))
    } catch {
      setCodes([])
    }
  }, [campaign.id, isDm])

  useEffect(() => {
    void loadCodes()
  }, [loadCodes])

  /** DM: mint a new player invite code. */
  async function handleCreateCode() {
    if (!currentUserId) return
    setWorking(true)
    setError(null)
    try {
      await createInviteCode(campaign.id, currentUserId, 'player')
      setCodes(await listInviteCodes(campaign.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create code.')
    } finally {
      setWorking(false)
    }
  }

  /** DM: revoke an existing code. */
  async function handleRevoke(codeId: string) {
    setWorking(true)
    setError(null)
    try {
      await deleteInviteCode(codeId)
      setCodes((prev) => prev.filter((c) => c.id !== codeId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke code.')
    } finally {
      setWorking(false)
    }
  }

  /** Copies a code to the clipboard (best-effort; no error if unsupported). */
  function copyCode(code: string) {
    void navigator.clipboard?.writeText(code)
  }

  /**
   * Owner: permanently delete the campaign, then return to the dashboard.
   * Cascade FKs remove all members and invite codes at the DB level.
   */
  async function handleDeleteCampaign() {
    setWorking(true)
    setError(null)
    try {
      await deleteCampaign(campaign.id)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete campaign.')
      setWorking(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      {error && <div style={{ marginBottom: 'var(--space-4)' }}><FormError message={error} /></div>}

      {/* Campaign name + DM rename. */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        {renaming ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={120}
              aria-label="Campaign name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename()
                if (e.key === 'Escape') { setNameDraft(campaign.name); setRenaming(false) }
              }}
              style={{ flex: '1 1 220px', minWidth: 180, font: 'inherit', fontSize: '1.3rem', fontWeight: 700, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }}
            />
            <Button style={{ width: 'auto' }} busy={savingName} onClick={handleRename}>Save</Button>
            <Button variant="secondary" style={{ width: 'auto' }} disabled={savingName} onClick={() => { setNameDraft(campaign.name); setRenaming(false) }}>Cancel</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{campaign.name}</h1>
            {isDm && (
              <button
                onClick={() => { setNameDraft(campaign.name); setRenaming(true) }}
                style={{ font: 'inherit', fontSize: '0.85rem', background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-3)', cursor: 'pointer' }}
              >
                Rename campaign
              </button>
            )}
          </div>
        )}
      </section>

      {/* Roster — visible to all members. */}
      <section>
        <h2 style={{ fontSize: '1.1rem' }}>Members ({members.length})</h2>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
          {members.map((m) => (
            <li
              key={m.userId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
              }}
            >
              <span>
                {m.displayName || 'Unnamed adventurer'}
                {m.userId === currentUserId && (
                  <span style={{ color: 'var(--color-text-muted)' }}> (you)</span>
                )}
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                {m.role === 'dm' ? 'DM' : 'Player'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Invite codes — DM only. */}
      {isDm && (
        <section style={{ marginTop: 'var(--space-8)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Invite codes</h2>
            <Button style={{ width: 'auto' }} busy={working} onClick={handleCreateCode}>
              New player code
            </Button>
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Share a code so a player can join from their dashboard. Revoke any you
            no longer want to work.
          </p>
          {codes.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>No codes yet.</p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                display: 'grid',
                gap: 'var(--space-2)',
              }}
            >
              {codes.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3) var(--space-4)',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <code style={{ fontSize: '1.1rem', letterSpacing: '0.15em', fontWeight: 700 }}>
                    {c.code}
                  </code>
                  <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <Button
                      variant="secondary"
                      style={{ width: 'auto' }}
                      onClick={() => copyCode(c.code)}
                    >
                      Copy
                    </Button>
                    <Button
                      variant="secondary"
                      style={{ width: 'auto', color: 'var(--color-danger)' }}
                      onClick={() => handleRevoke(c.id)}
                    >
                      Revoke
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Backup & data — export/import (Phase 4.2). DM only. */}
      {isDm && <CampaignDataPanel campaignId={campaign.id} campaignName={campaign.name} />}

      {/* Danger zone — deleting the campaign. Owner (creating DM) only, to match
          the campaigns_delete_owner RLS policy. */}
      {isOwner && (
        <section
          style={{
            marginTop: 'var(--space-8)',
            padding: 'var(--space-6)',
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius)',
          }}
        >
          <h2 style={{ fontSize: '1.1rem', marginTop: 0, color: 'var(--color-danger)' }}>
            Danger zone
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Deleting this campaign permanently removes it for everyone, along with
            all memberships and invite codes. This cannot be undone.
          </p>
          {confirmingDelete ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Button
                style={{ width: 'auto', background: 'var(--color-danger)' }}
                busy={working}
                onClick={handleDeleteCampaign}
              >
                Yes, delete “{campaign.name}”
              </Button>
              <Button
                variant="secondary"
                style={{ width: 'auto' }}
                disabled={working}
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              style={{ width: 'auto', color: 'var(--color-danger)' }}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete campaign
            </Button>
          )}
        </section>
      )}
    </div>
  )
}
