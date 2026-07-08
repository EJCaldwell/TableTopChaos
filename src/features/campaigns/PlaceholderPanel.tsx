/**
 * PlaceholderPanel — the "coming soon" body for workspace tabs that don't have
 * real content yet (everything except Overview in Phase 1.4).
 *
 * Owns: a consistent, friendly empty state so the role-aware shell feels
 * complete while later phases fill in each tab. Purely presentational.
 */
import type { WorkspaceTab } from './tabs'

/**
 * @param tab - The tab whose placeholder to render (supplies label + blurb).
 */
export function PlaceholderPanel({ tab }: { tab: WorkspaceTab }) {
  return (
    <div
      style={{
        marginTop: 'var(--space-6)',
        padding: 'var(--space-8)',
        textAlign: 'center',
        background: 'var(--color-surface)',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{tab.label}</h2>
      <p style={{ color: 'var(--color-text-muted)', maxWidth: 420, margin: 'var(--space-3) auto 0' }}>
        {tab.blurb}
      </p>
      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginTop: 'var(--space-6)',
        }}
      >
        Coming soon
      </p>
    </div>
  )
}
