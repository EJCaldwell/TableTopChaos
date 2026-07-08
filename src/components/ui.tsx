/**
 * ui.tsx — small shared presentational primitives.
 *
 * Owns: the handful of styled building blocks (button, labelled text field,
 * form error, centered card) reused across auth and profile screens. These are
 * deliberately lightweight wrappers over native elements styled with the design
 * tokens (styles/tokens.css) rather than a component library — keeping the MVP
 * bundle small. Promote to a real library later if the UI grows.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react'
import { useId } from 'react'

/**
 * Button — a token-styled button with a primary/secondary variant and a
 * built-in busy state.
 *
 * @param variant - Visual weight; `primary` is the accent-filled default.
 * @param busy - When true, disables the button and shows a working label.
 * @param children - Button label.
 * Remaining props are forwarded to the native <button>.
 */
export function Button({
  variant = 'primary',
  busy = false,
  children,
  disabled,
  style,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
  busy?: boolean
}) {
  const isPrimary = variant === 'primary'
  return (
    <button
      // Disable while busy so a form can't be double-submitted.
      disabled={disabled || busy}
      style={{
        appearance: 'none',
        border: '1px solid',
        borderColor: isPrimary ? 'var(--color-accent)' : 'var(--color-border)',
        background: isPrimary ? 'var(--color-accent)' : 'transparent',
        color: isPrimary ? '#fff' : 'var(--color-text)',
        padding: 'var(--space-2) var(--space-4)',
        borderRadius: 'var(--radius)',
        font: 'inherit',
        fontWeight: 600,
        cursor: disabled || busy ? 'not-allowed' : 'pointer',
        opacity: disabled || busy ? 0.6 : 1,
        width: '100%',
        ...style,
      }}
      {...rest}
    >
      {busy ? 'Working…' : children}
    </button>
  )
}

/**
 * TextField — a labelled input. Generates a stable id so the <label> is
 * correctly associated with the <input> for accessibility.
 *
 * @param label - Visible field label.
 * Remaining props are forwarded to the native <input> (type, value, onChange…).
 */
export function TextField({
  label,
  style,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <label htmlFor={id} style={{ fontSize: '0.85rem', fontWeight: 600 }}>
        {label}
      </label>
      <input
        id={id}
        style={{
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          borderRadius: 'var(--radius)',
          padding: 'var(--space-2) var(--space-3)',
          font: 'inherit',
          ...style,
        }}
        {...rest}
      />
    </div>
  )
}

/**
 * FormError / FormNotice — inline status lines for forms. `FormError` renders
 * nothing when `message` is falsy so callers can render it unconditionally.
 */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, fontSize: '0.9rem' }}>
      {message}
    </p>
  )
}

export function FormNotice({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p style={{ color: 'var(--color-success)', margin: 0, fontSize: '0.9rem' }}>
      {message}
    </p>
  )
}

/**
 * AuthCard — a centered card used as the frame for auth pages (login, signup,
 * password reset). Keeps those pages visually consistent.
 *
 * @param title - Heading shown at the top of the card.
 * @param children - Card body (typically a form).
 * @param footer - Optional secondary content below the body (e.g. nav links).
 */
export function AuthCard({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: 'var(--space-8)',
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 'var(--space-6)', fontSize: '1.4rem' }}>
          {title}
        </h1>
        {children}
        {footer && (
          <div
            style={{
              marginTop: 'var(--space-6)',
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--color-border)',
              fontSize: '0.9rem',
              color: 'var(--color-text-muted)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </main>
  )
}
