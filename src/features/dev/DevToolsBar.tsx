/**
 * DevToolsBar — the dev-only test controls for a campaign (Phase 9.1a).
 *
 * Renders nothing at all unless {@link useDevAccess} allows it: a dev build,
 * signed in as an allowlisted account.
 *
 * WHAT IT DOES. Lets a DM re-render their campaign the way a PLAYER sees it,
 * without signing out or opening a second browser. One session, one identity,
 * two renderings.
 *
 * WHY THAT IS SAFE, since "act as someone else" usually is not: this grants
 * LESS access, not more. The DM voluntarily hides things they are entitled to
 * see. Choosing to see less of your own data cannot escalate anything, which is
 * why the whole feature is client-side with no server involvement.
 *
 * WHAT IT CANNOT TELL YOU, and this is the important part. It shows what the UI
 * would RENDER for a player — not what RLS would RETURN for one. The queries
 * still run as the DM and still come back with everything; the view just
 * declines to draw some of it. So it is a good check that tabs and controls are
 * gated correctly, and it is NOT evidence that a player cannot reach the data.
 * Only the server-side matrix (railway/scripts/95_rls_matrix.sql) is that. The
 * banner says so on screen, because a tool that quietly overstates what it
 * proves is worse than no tool.
 *
 * The banner is also not decoration: a DM who forgets they are in player view
 * and reports a missing tab as a bug has been actively misled.
 */
import { resetAllLayouts } from '../campaigns/layout'
import type { Member } from '../campaigns/api'

/** Props for {@link DevToolsBar}. */
interface DevToolsBarProps {
  /** The caller's REAL role in this campaign, before any view override. */
  isDm: boolean
  /** Whether the player view is currently active. */
  viewAsPlayer: boolean
  /** Toggle the player view. */
  onToggleViewAsPlayer: (next: boolean) => void
  /** The signed-in user's id, for the "who am I" readout. */
  currentUserId?: string
  /** The signed-in user's username, for the same. */
  username?: string | null
  /** The campaign roster, to populate the character switcher. */
  members: Member[]
  /** Whose character sheet the character panels are currently showing. */
  characterUserId?: string
  /**
   * Change the character-sheet subject. Called with `undefined` to go back to
   * the caller's own sheet.
   */
  onChangeCharacterUserId: (next: string | undefined) => void
}

/**
 * Dev-only campaign test controls.
 * @param props - See {@link DevToolsBarProps}.
 */
export function DevToolsBar({
  isDm,
  viewAsPlayer,
  onToggleViewAsPlayer,
  currentUserId,
  username,
  members,
  characterUserId,
  onChangeCharacterUserId,
}: DevToolsBarProps) {
  const active = isDm && viewAsPlayer
  // Are we looking at somebody else's sheet? `characterUserId` is set to the
  // caller's own id by "(me)", which is not an override, so compare rather than
  // testing for presence.
  const inspecting = !!characterUserId && characterUserId !== currentUserId

  return (
    <div
      style={{
        // Loud on purpose while the view is overridden, quiet otherwise. The
        // point is that you cannot forget which mode you are in.
        background: active || inspecting ? 'var(--color-danger)' : 'var(--color-bg)',
        color: active || inspecting ? '#fff' : 'var(--color-text-muted)',
        borderBottom: '1px solid var(--color-border)',
        padding: 'var(--space-2) var(--space-4)',
        fontSize: '0.8rem',
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'center',
        flexWrap: 'wrap',
        flexShrink: 0,
      }}
    >
      <strong style={{ letterSpacing: '0.04em' }}>DEV</strong>

      {/* Who am I. Most of this project's confusing moments began with not
          knowing which account a window was signed in as, and the project rules
          out handing the user console snippets — so it belongs on screen. */}
      <span>
        {username ?? 'unknown'}
        {currentUserId && (
          <span style={{ opacity: 0.75 }}> · {currentUserId.slice(0, 8)}</span>
        )}
        <span style={{ opacity: 0.75 }}> · real role: {isDm ? 'DM' : 'player'}</span>
      </span>

      {isDm && (
        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={viewAsPlayer}
            onChange={(e) => onToggleViewAsPlayer(e.target.checked)}
          />
          View as player
        </label>
      )}

      {active && (
        <strong>
          Viewing as a PLAYER — this hides DM-only UI. It does NOT prove a player
          cannot read the data; only the server-side RLS matrix does that.
        </strong>
      )}

      {/* Character switcher (9.1a.2). Points the character-scoped panels at
          another member's sheet.

          WHY THIS IS NOT A CLIENT-SIDE TRICK. Unlike "view as player", which
          hides data you are entitled to see, this both SHOWS and EDITS data
          belonging to someone else. Reads work because a DM already has read
          access to every character in their campaign; WRITES exist only because
          migration 0052 grants them to accounts in `private.dev_accounts` —
          a table no client can read or insert into. So the edits are real and
          permanent, and the bar says so, because an edit you make on someone
          else's sheet believing it is a sandbox is the worst outcome here.

          The Journal is excluded on purpose (0054) and stays private even from
          a dev account: an inspected journal is empty, and that is the policy
          working. Ownership cannot be transferred through this path either
          (0053). */}
      {isDm && (
        <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          Sheet:
          <select
            value={characterUserId ?? ''}
            onChange={(e) => onChangeCharacterUserId(e.target.value || undefined)}
            style={{ font: 'inherit', fontSize: '0.8rem' }}
          >
            <option value="">(me)</option>
            {members
              .filter((m) => m.userId !== currentUserId)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.username}
                </option>
              ))}
          </select>
        </label>
      )}

      {inspecting && (
        <strong>
          Editing another member's REAL sheet — saves are permanent and they will
          see them. Their Journal stays private even from you.
        </strong>
      )}

      <button
        type="button"
        onClick={() => {
          const n = resetAllLayouts()
          // A count, including zero: "nothing to reset" and "the button did
          // nothing" are otherwise indistinguishable.
          window.alert(`Reset ${n} campaign layout${n === 1 ? '' : 's'} in this browser.`)
        }}
        style={{
          font: 'inherit',
          fontSize: '0.8rem',
          cursor: 'pointer',
          marginLeft: 'auto',
          background: 'transparent',
          color: 'inherit',
          border: '1px solid currentColor',
          borderRadius: 'var(--radius)',
          padding: '2px 8px',
        }}
      >
        Reset layouts
      </button>
    </div>
  )
}
