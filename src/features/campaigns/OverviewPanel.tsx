/**
 * OverviewPanel — the "Overview" tab body of the campaign workspace.
 *
 * Owns the *people and timing* side of a campaign: the member roster (visible to
 * everyone), DM-only invite-code management (create/copy/revoke), a read-only
 * note of which game mode the campaign is in, and — since 5.2.1h — session
 * **scheduling**, folded in from what used to be its own tab. Scheduling answers
 * the same question as the roster ("who's in this campaign and when are we
 * playing?") and didn't need a rail slot of its own.
 *
 * Campaign *administration* — renaming, switching game mode, backups, and
 * deleting — used to live here too, and moved to the DM-only Settings tab
 * (<SettingsPanel>) once this tab had grown too many unrelated jobs. The rule of
 * thumb: Overview answers "who's in this campaign, how do I add someone, and
 * when are we playing?"; Settings answers "how is this campaign configured?".
 *
 * Overview is reached from the APP HEADER ("Campaign overview", beside the home
 * link), not from the tab rail at all, and also opens by itself when you enter
 * the campaign from the dashboard. It is campaign-level reference material —
 * the same altitude as the home link next to it — while the rail lists the
 * places you actually work. Being in the header also means it is reachable from
 * anywhere, including a playspace campaign where the map owns the middle.
 *
 * DM gating here is UI convenience; the real enforcement is RLS (migrations
 * 0003–0004): a player's client cannot read or write invite codes at all.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, FormError } from '../../components/ui'
import { SchedulePanel } from '../schedule/SchedulePanel'
import {
  createInviteCode,
  deleteInviteCode,
  listInviteCodes,
  GAME_MODES,
  type Campaign,
  type GameMode,
  type InviteCode,
  type Member,
} from './api'

/**
 * Human-readable name for a game mode, for the read-only line below.
 * @param mode - The mode to label.
 * @returns Its display label from GAME_MODES, or the raw value if unknown.
 */
function labelFor(mode: GameMode): string {
  return GAME_MODES.find((m) => m.value === mode)?.label ?? mode
}

/**
 * @param campaign - The loaded campaign (for its id and current game mode).
 * @param members - The full roster (already sorted DM-first by the shell).
 * @param isDm - Whether the caller is a DM (gates the invite-code section, and
 *        decides whether the mode line points at Settings).
 * @param currentUserId - The caller's auth id, to mark "(you)" and stamp
 *        created_by on new invite codes.
 */
export function OverviewPanel({
  campaign,
  members,
  isDm,
  currentUserId,
  onEnterWorkspace,
}: {
  campaign: Campaign
  members: Member[]
  isDm: boolean
  currentUserId: string | undefined
  /** Leave the overview page for the campaign workspace / playspace. */
  onEnterWorkspace?: () => void
}) {
  const [codes, setCodes] = useState<InviteCode[]>([])
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

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
      await createInviteCode(campaign.id, currentUserId)
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

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <FormError message={error} />
        </div>
      )}

      {/* Game mode — read-only here for everyone; the DM changes it in Settings. */}
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginTop: 0 }}>
        This campaign plays as <strong>{labelFor(campaign.game_mode)}</strong>.
        {isDm ? ' Change it in the Settings tab.' : ' Only the DM can change it.'}
      </p>

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

        {/* The way in. Sits directly under the roster because Overview is the
            landing page and this is the one thing you came here to do next —
            the header toggle alone was too quiet for a primary action. Wording
            follows the campaign's mode so it names where you are actually
            going. */}
        {onEnterWorkspace && (
          <div style={{ marginTop: 'var(--space-5)' }}>
            <Button style={{ width: 'auto' }} onClick={onEnterWorkspace}>
              {campaign.game_mode === 'notetaker'
                ? 'Open the campaign workspace →'
                : 'Enter the playspace →'}
            </Button>
            <p
              style={{
                color: 'var(--color-text-muted)',
                fontSize: '0.85rem',
                margin: 'var(--space-2) 0 0',
              }}
            >
              {campaign.game_mode === 'notetaker'
                ? 'Your sheets, notes and DM tools.'
                : 'The shared battlemap, plus your sheets, notes and DM tools.'}
            </p>
          </div>
        )}
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

      {/* Scheduling — folded in from its own tab in 5.2.1h. It is the other
          "who is in this campaign and when are we playing" question, so it sits
          with the roster rather than competing for a rail slot of its own.
          SchedulePanel renders its own heading and owns its data/RLS. */}
      {currentUserId && (
        <section style={{ marginTop: 'var(--space-8)' }}>
          <SchedulePanel campaignId={campaign.id} currentUserId={currentUserId} isDm={isDm} />
        </section>
      )}
    </div>
  )
}
