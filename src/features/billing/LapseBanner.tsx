/**
 * LapseBanner — the in-app half of the deletion countdown promised by the
 * Refunds page ("the countdown is shown in the app").
 *
 * Rendered across the top of the campaign workspace for EVERY member, not just
 * the DM. That is the point: when a campaign lapses it freezes for everyone,
 * and when it is deleted every player loses their character sheet and journal
 * with it. Showing this only to the person who pays would mean the people with
 * the most to lose never see it.
 *
 * It renders nothing at all when the campaign is writable, which is the normal
 * case and — while `enforce_active` is false — the only case.
 *
 * Two visual states, because they are genuinely different situations:
 *   * deletionEnabled = false → grey. The clock runs and is honest about it,
 *     but nothing will actually be deleted. This is what production looks like
 *     during the observation period before the second kill-switch is flipped.
 *   * deletionEnabled = true  → escalates to danger inside the final week.
 *
 * The email warnings and this banner are deliberately independent paths to the
 * same fact. Email can be undeliverable (see PRE_LAUNCH on the Resend sending
 * domain); this cannot.
 */
import { useEffect, useState } from 'react'
import { getLapseStatus, type LapseStatus } from './api'

/** Props for {@link LapseBanner}. */
interface LapseBannerProps {
  /** Campaign whose countdown to show. */
  campaignId: string
}

/**
 * Campaign-wide deletion countdown, or null when there is nothing to say.
 * @param props - See {@link LapseBannerProps}.
 */
export function LapseBanner({ campaignId }: LapseBannerProps) {
  const [status, setStatus] = useState<LapseStatus | null>(null)

  useEffect(() => {
    let active = true
    // Errors are swallowed on purpose. A failed countdown read must never
    // block or disfigure the workspace — the banner is a notice, not a gate,
    // and the sweep does not consult it.
    getLapseStatus(campaignId)
      .then((s) => {
        if (active) setStatus(s)
      })
      .catch(() => {
        if (active) setStatus(null)
      })
    return () => {
      active = false
    }
  }, [campaignId])

  if (!status?.readOnlySince) return null

  const days = status.daysRemaining ?? 0
  const urgent = status.deletionEnabled && days <= 7
  const color = urgent ? 'var(--color-danger)' : 'var(--color-text-muted)'

  return (
    <div
      // role="status" rather than "alert": this is important but not something
      // that should interrupt a screen-reader user mid-sentence on every page
      // load of a campaign they already know is lapsed.
      role="status"
      style={{
        borderBottom: `1px solid ${urgent ? 'var(--color-danger)' : 'var(--color-border)'}`,
        background: 'var(--color-bg)',
        color,
        padding: 'var(--space-2) var(--space-4)',
        fontSize: '0.85rem',
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'center',
        flexWrap: 'wrap',
        flexShrink: 0,
      }}
    >
      <strong>This campaign is read-only.</strong>
      {status.deletionEnabled ? (
        <span>
          It will be permanently deleted in{' '}
          <strong>{days === 1 ? '1 day' : `${days} days`}</strong>
          {status.deleteAfter && ` (${new Date(status.deleteAfter).toLocaleDateString()})`},
          along with its images. Subscribe again to keep it, or export it first.
        </span>
      ) : (
        // Says plainly that nothing will be deleted. A countdown that looks
        // live but is not would train people to ignore the real one.
        <span>
          Subscribe again to unlock it. Long-abandoned campaigns are eventually
          deleted; automatic deletion is not switched on yet, so nothing will be
          removed.
        </span>
      )}
    </div>
  )
}
