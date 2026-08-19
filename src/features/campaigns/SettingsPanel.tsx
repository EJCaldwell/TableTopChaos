/**
 * SettingsPanel — the "Settings" tab body of the campaign workspace.
 *
 * Two tiers of content, and the split matters:
 *   - **Workspace** — personal view preferences (which side the tab rail sits
 *     on, reset layout). Shown to **everyone, players included**: this is
 *     browser-local state that affects nobody else, so there is nothing to gate.
 *     This is why Settings became an `audience: 'all'` tab in 5.2.1f.
 *   - **Campaign administration** — name, game mode (Phase 5.1), plan & billing,
 *     backup export, and the destructive delete. **DM only**, and rendered only
 *     when `isDm`. Visited rarely, which is why it lives at the foot of the rail.
 *
 * A player therefore opens Settings and sees exactly one section. The `isDm`
 * check here is UI convenience; the real enforcement is RLS —
 * campaigns_update_dm for rename/mode, campaigns_delete_owner for the delete —
 * so a player who forced their way past it could still not write anything.
 *
 * (Import lives on the dashboard, not here: it creates a *new* campaign rather
 * than touching this one.)
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, FormError } from '../../components/ui'
import { BillingPanel } from '../billing/BillingPanel'
import { CampaignDataPanel } from '../exportImport/CampaignDataPanel'
import { ModePicker } from './ModePicker'
import {
  deleteCampaign,
  gameModeRank,
  renameCampaign,
  setGameMode,
  GAME_MODES,
  type Campaign,
  type GameMode,
} from './api'

/**
 * Human-readable name for a game mode, for use in prose and buttons.
 * @param mode - The mode to label.
 * @returns Its display label from GAME_MODES, or the raw value if unknown.
 */
function labelFor(mode: GameMode): string {
  return GAME_MODES.find((m) => m.value === mode)?.label ?? mode
}

/** Shared card styling for each settings section. */
const sectionStyle: React.CSSProperties = {
  marginBottom: 'var(--space-6)',
  padding: 'var(--space-6)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius)',
}

/**
 * Workspace preference controls handed down from the shell, which owns the
 * layout state. Kept as an explicit prop rather than reaching into storage from
 * here so there is exactly one writer of the layout.
 */
export interface WorkspacePrefs {
  /** Close every window and restore the default rail size and position. */
  onResetLayout: () => void
}

/**
 * @param campaign - The loaded campaign (name, game_mode, owner_id…).
 * @param isDm - Whether the caller is the DM. Everyone sees the Workspace
 *        section; only a DM sees campaign administration below it.
 * @param workspace - Layout preference controls (see WorkspacePrefs).
 * @param isOwner - Whether the caller owns the campaign. Gates the danger zone
 *        so the UI check mirrors campaigns_delete_owner exactly (that policy is
 *        owner-based, while the rest of this panel is DM-based). In practice a
 *        campaign's only DM *is* its owner, so this is belt-and-braces.
 * @param onRenamed - Called after a successful rename so the shell updates its
 *        header without a refetch.
 * @param onModeChanged - Called after a successful game-mode switch so the shell
 *        re-renders its mode-aware chrome immediately.
 */
export function SettingsPanel({
  campaign,
  isDm,
  workspace,
  isOwner,
  onRenamed,
  onModeChanged,
}: {
  campaign: Campaign
  isDm: boolean
  workspace: WorkspacePrefs
  isOwner: boolean
  onRenamed?: (name: string) => void
  onModeChanged?: (mode: GameMode) => void
}) {
  const navigate = useNavigate()

  const [error, setError] = useState<string | null>(null)

  // Campaign rename: editing flag + the in-progress name draft.
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(campaign.name)
  const [savingName, setSavingName] = useState(false)

  // Game-mode switching. `pendingMode` is the mode the DM picked but has not
  // confirmed yet — null means "no switch in flight". Kept separate from
  // campaign.game_mode so the picker can show the intended target while the
  // confirmation explains what the switch will do.
  const [pendingMode, setPendingMode] = useState<GameMode | null>(null)
  const [savingMode, setSavingMode] = useState(false)

  // Whether the destructive delete confirmation is currently showing.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  /** Persist the renamed campaign, then update the header via onRenamed. */
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
   * Commit the pending game-mode switch, then tell the shell so its chrome
   * updates without a refresh. RLS (campaigns_update_dm) is the real gate — a
   * player's update matches zero rows and setGameMode throws.
   */
  async function handleConfirmMode() {
    if (!pendingMode) return
    setSavingMode(true)
    setError(null)
    try {
      await setGameMode(campaign.id, pendingMode)
      onModeChanged?.(pendingMode)
      setPendingMode(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the game mode.')
    } finally {
      setSavingMode(false)
    }
  }

  /**
   * Owner: permanently delete the campaign, then return to the dashboard.
   * Cascade FKs remove every campaign-scoped row at the DB level.
   */
  async function handleDeleteCampaign() {
    setDeleting(true)
    setError(null)
    try {
      await deleteCampaign(campaign.id)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete campaign.')
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <FormError message={error} />
        </div>
      )}

      {/* Workspace — shown to EVERYONE, players included. These are personal
          view preferences stored per browser, not campaign data, so there is
          nothing role-specific to gate. */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Workspace</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
          How this campaign's workspace is arranged for you. Saved in this browser
          only — it doesn't affect anyone else in the campaign.
        </p>

        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          Which side the sidebar sits on is an account setting — it follows you
          into every campaign. Change it on your <strong>Profile</strong> page.
        </p>

        <div style={{ marginTop: 'var(--space-5)' }}>
          <strong style={{ fontSize: '0.9rem' }}>Reset workspace layout</strong>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 'var(--space-1) 0 var(--space-2)' }}>
            Closes every open panel and puts the sidebar back to its default size
            and side. Nothing in the campaign is deleted.
          </p>
          <Button variant="secondary" style={{ width: 'auto' }} onClick={workspace.onResetLayout}>
            Reset layout
          </Button>
        </div>
      </section>

      {/* ---- Everything below is campaign administration: DM only. ---- */}
      {!isDm ? null : (
        <>
      {/* Campaign name. */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Campaign name</h2>
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
                if (e.key === 'Escape') {
                  setNameDraft(campaign.name)
                  setRenaming(false)
                }
              }}
              style={{
                flex: '1 1 220px',
                minWidth: 180,
                font: 'inherit',
                fontSize: '1.1rem',
                fontWeight: 600,
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                padding: 'var(--space-2)',
                color: 'var(--color-text)',
              }}
            />
            <Button style={{ width: 'auto' }} busy={savingName} onClick={handleRename}>
              Save
            </Button>
            <Button
              variant="secondary"
              style={{ width: 'auto' }}
              disabled={savingName}
              onClick={() => {
                setNameDraft(campaign.name)
                setRenaming(false)
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '1.1rem' }}>{campaign.name}</strong>
            <Button
              variant="secondary"
              style={{ width: 'auto' }}
              onClick={() => {
                setNameDraft(campaign.name)
                setRenaming(true)
              }}
            >
              Rename
            </Button>
          </div>
        )}
      </section>

      {/* Game mode (Phase 5.1) — switchable at any time, behind a confirm step. */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Game mode</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
          Change this whenever you like. Your notes, sheets and journals are the same
          in every mode.
        </p>
        {/* The picker shows the pending choice while one is awaiting
            confirmation, otherwise the campaign's saved mode. */}
        <ModePicker
          value={pendingMode ?? campaign.game_mode}
          onChange={(mode) => {
            setError(null)
            // Re-picking the current mode is a no-op, so clear any pending switch
            // instead of asking the DM to confirm a change to itself.
            setPendingMode(mode === campaign.game_mode ? null : mode)
          }}
          disabled={savingMode}
          name={`game-mode-${campaign.id}`}
          label="This campaign plays as"
        />
        {pendingMode && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <p style={{ fontSize: '0.85rem', margin: '0 0 var(--space-3)' }}>
              {gameModeRank(pendingMode) > gameModeRank(campaign.game_mode)
                ? `Switching up to ${labelFor(pendingMode)} unlocks the extra features
                   for everyone in this campaign.`
                : `Switching down to ${labelFor(pendingMode)} only hides the richer
                   features — nothing is deleted. Any maps, tokens and combat you've
                   set up are kept and come back if you switch up again.`}
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Button style={{ width: 'auto' }} busy={savingMode} onClick={handleConfirmMode}>
                Switch to {labelFor(pendingMode)}
              </Button>
              <Button
                variant="secondary"
                style={{ width: 'auto' }}
                disabled={savingMode}
                onClick={() => setPendingMode(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Plan & billing (Phase 1.5.2) — its own tab until 5.2, folded in here as
          campaign administration. BillingPanel renders its own heading. */}
      <section style={sectionStyle}>
        {/* BillingPanel's own <h2>s are status titles ("Trial active", …), so the
            section needs this heading to name itself in the Settings stack. */}
        <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>Plan &amp; billing</h2>
        <BillingPanel campaignId={campaign.id} />
      </section>

      {/* Backup & data — export only (Phase 4.2). Renders its own <section>. */}
      <CampaignDataPanel campaignId={campaign.id} campaignName={campaign.name} />

      {/* Danger zone — owner (creating DM) only, to match campaigns_delete_owner. */}
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
            Deleting this campaign permanently removes it for everyone, along with all
            memberships, invite codes, and campaign content. This cannot be undone.
            Consider exporting a backup first.
          </p>
          {confirmingDelete ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Button
                style={{ width: 'auto', background: 'var(--color-danger)' }}
                busy={deleting}
                onClick={handleDeleteCampaign}
              >
                Yes, delete “{campaign.name}”
              </Button>
              <Button
                variant="secondary"
                style={{ width: 'auto' }}
                disabled={deleting}
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
        </>
      )}
    </div>
  )
}
