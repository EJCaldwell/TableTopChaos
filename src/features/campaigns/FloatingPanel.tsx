/**
 * FloatingPanel — a draggable, resizable in-page window holding one popped-out
 * workspace panel (Phase 5.2).
 *
 * Used by the workspace shell in every game mode: clicking a rail entry opens
 * the panel in one of these, so several are visible at once — a player watching
 * the battlemap while editing their sheet, or a DM with NPCs and Quests side by
 * side. It is an ordinary absolutely-positioned div inside the workspace area —
 * deliberately NOT a real browser window, so there are no popup blockers, no
 * second document to copy styles into, and no orphaned window surviving a
 * refresh.
 *
 * Interaction model: drag by the title bar; resize from **any edge or corner**
 * (eight handles). Both use Pointer Events with `setPointerCapture`, so a fast
 * drag that outruns the cursor still delivers its moves here and always ends
 * with a `pointerup` — the failure mode with plain mouse listeners is a window
 * stuck to the cursor.
 *
 * Position is committed to the parent only on release, not on every move: the
 * parent persists layout to localStorage, and writing there ~60×/second during a
 * drag is pure waste. While interacting we render from local state instead.
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MIN_FLOAT_H, MIN_FLOAT_W, snapToEdges, type FloatRect } from './layout'

/**
 * Which handle an interaction started from. `move` is the title bar; the rest
 * are compass directions naming the edge(s) being dragged, so 'nw' resizes from
 * the top-left corner and moves the window's origin as it does.
 */
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** What a live drag/resize is tracking, or null when idle. */
interface Interaction {
  handle: Handle
  /** Pointer position when it began, in client coords. */
  startX: number
  startY: number
  /** The rect when it began; deltas are applied to this, never accumulated. */
  startRect: FloatRect
}

/**
 * Applies a pointer delta to the rect an interaction started from.
 *
 * Resizing from a north or west edge is the interesting case: the size changes
 * *and* the origin moves, and both must stop together when the minimum is hit —
 * otherwise the window appears to slide sideways once it can no longer shrink.
 * Deriving the clamped dimension first and moving the origin by the difference
 * keeps the opposite edge pinned exactly where the user left it.
 *
 * @param it - The interaction in progress.
 * @param dx - Horizontal pointer delta since it began.
 * @param dy - Vertical pointer delta.
 * @param bounds - Workspace area size, for clamping a move. 0 means unknown.
 * @returns The rect to render.
 */
function applyDelta(
  it: Interaction,
  dx: number,
  dy: number,
  bounds: { w: number; h: number },
): FloatRect {
  const start = it.startRect

  if (it.handle === 'move') {
    // Clamp so part of the title bar always stays grabbable. Symmetric
    // horizontally — a window may hang off the LEFT edge as far as it may hang
    // off the right (see clampRect) — but the top is a hard stop, since the
    // title bar is the only drag handle.
    const minX = Math.min(0, 80 - start.w)
    const maxX = Math.max(minX, (bounds.w || start.x + start.w) - 80)
    const maxY = Math.max(0, (bounds.h || start.y + start.h) - 40)
    return {
      ...start,
      x: Math.min(Math.max(minX, start.x + dx), maxX),
      y: Math.min(Math.max(0, start.y + dy), maxY),
    }
  }

  let { x, y, w, h } = start
  if (it.handle.includes('e')) w = Math.max(MIN_FLOAT_W, start.w + dx)
  if (it.handle.includes('s')) h = Math.max(MIN_FLOAT_H, start.h + dy)
  if (it.handle.includes('w')) {
    w = Math.max(MIN_FLOAT_W, start.w - dx)
    // Never let the left edge cross the workspace origin.
    x = Math.max(0, start.x + (start.w - w))
  }
  if (it.handle.includes('n')) {
    h = Math.max(MIN_FLOAT_H, start.h - dy)
    y = Math.max(0, start.y + (start.h - h))
  }
  return { x, y, w, h }
}

/**
 * @param title - Shown in the title bar; also the accessible name of the window.
 * @param rect - The committed position/size. Ignored while a drag is in flight.
 * @param zIndex - Stacking order, assigned by the parent from its panel order.
 * @param bounds - Size of the containing workspace area, used to keep the window
 *                 from being dragged fully out of reach. Pass 0s if unknown.
 * @param onRectChange - Called ONCE per interaction, on release, with the final
 *                       rect. The parent persists it.
 * @param onFocus - Called on any pointer-down anywhere in the window, so the
 *                  parent can bring it to the front.
 * @param onClose - Close the panel entirely. There is no "dock" action: since
 *                  5.2.1c a floating window is the only place a panel lives.
 * @param fixed - Disable dragging and resizing. Used for Settings, which opens
 *                near-full-screen and always on top: it is modal in feel, and a
 *                window you cannot put behind anything gains nothing from being
 *                movable — moving it could only ever make it worse placed.
 * @param hidden - Render the window but keep it off screen with `display:none`.
 *                 The shell uses this for "closed" panels so their React tree
 *                 stays mounted — see WorkspaceShell for why that matters.
 * @param children - The panel body (a <TabBody>).
 */
export function FloatingPanel({
  title,
  rect,
  zIndex,
  bounds,
  onRectChange,
  onFocus,
  onClose,
  fixed,
  hidden,
  children,
}: {
  title: string
  rect: FloatRect
  zIndex: number
  bounds: { w: number; h: number }
  onRectChange: (rect: FloatRect) => void
  onFocus: () => void
  onClose: () => void
  fixed?: boolean
  hidden?: boolean
  children: ReactNode
}) {
  const interaction = useRef<Interaction | null>(null)
  // The rect being previewed mid-drag. null when idle, so `rect` wins.
  const [live, setLive] = useState<FloatRect | null>(null)
  const current = live ?? rect

  /** Starts a drag or resize and captures the pointer to the handle element. */
  function begin(handle: Handle, e: React.PointerEvent) {
    // Ignore secondary buttons so a right-click doesn't strand the window in a
    // drag that never receives its pointerup.
    if (fixed || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    interaction.current = { handle, startX: e.clientX, startY: e.clientY, startRect: current }
    setLive(current)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  /** Previews the interaction's result. */
  function move(e: React.PointerEvent) {
    const it = interaction.current
    if (!it) return
    setLive(applyDelta(it, e.clientX - it.startX, e.clientY - it.startY, bounds))
  }

  /**
   * Commits the previewed rect to the parent and returns to idle, snapping
   * flush to any edge the window was dropped near. Snapping happens here rather
   * than during `move` so it never tugs against the pointer mid-drag.
   */
  function end() {
    if (!interaction.current) return
    interaction.current = null
    if (live) onRectChange(snapToEdges(live, bounds))
    setLive(null)
  }

  /** Props shared by all eight resize handles. */
  function handleProps(handle: Handle, style: CSSProperties) {
    return {
      role: 'presentation' as const,
      onPointerDown: (e: React.PointerEvent) => begin(handle, e),
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: end,
      style: { position: 'absolute' as const, touchAction: 'none' as const, ...style },
    }
  }

  // Handles are inset slightly and overlap at the corners, which are listed
  // last so they sit above the edges and win the pointer.
  const T = 8 // handle thickness, in px

  return (
    <section
      aria-label={`${title} (floating panel)`}
      aria-hidden={hidden || undefined}
      onPointerDown={onFocus}
      style={{
        // `display:none` rather than unmounting: the panel keeps its state and
        // its loaded data, and is also removed from the accessibility tree and
        // the tab order, so a hidden window is not reachable by keyboard.
        display: hidden ? 'none' : 'flex',
        position: 'absolute',
        left: current.x,
        top: current.y,
        width: current.w,
        height: current.h,
        zIndex,
        flexDirection: 'column',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.45)',
        overflow: 'hidden',
      }}
    >
      {/* Title bar — the drag handle. */}
      <header
        onPointerDown={(e) => begin('move', e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--color-border)',
          cursor: fixed ? 'default' : interaction.current?.handle === 'move' ? 'grabbing' : 'grab',
          // Stops the drag from selecting the title text or scroll-panning touch.
          userSelect: 'none',
          touchAction: 'none',
          flexShrink: 0,
        }}
      >
        {/* Spacer mirroring the button cluster's width, so the title lands in
            the true centre of the bar rather than the centre of what's left. */}
        <span aria-hidden style={{ width: 28, flexShrink: 0 }} />
        <strong
          style={{
            fontSize: '0.9rem',
            flex: 1,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </strong>
        <FloatButton label={`Close ${title}`} onClick={onClose}>
          ✕
        </FloatButton>
      </header>

      {/* Body. Scrolls independently — these are full workspace panels and are
          routinely taller than whatever the user sized the window to. */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)' }}>{children}</div>

      {/* ---- Resize handles: four edges, then four corners on top ----
          Omitted entirely when fixed, so there is no dead cursor hint. ---- */}
      {fixed ? null : (
        <>
      <div {...handleProps('n', { top: 0, left: T, right: T, height: T, cursor: 'ns-resize' })} />
      <div {...handleProps('s', { bottom: 0, left: T, right: T, height: T, cursor: 'ns-resize' })} />
      <div {...handleProps('w', { left: 0, top: T, bottom: T, width: T, cursor: 'ew-resize' })} />
      <div {...handleProps('e', { right: 0, top: T, bottom: T, width: T, cursor: 'ew-resize' })} />
      <div {...handleProps('nw', { top: 0, left: 0, width: T, height: T, cursor: 'nwse-resize' })} />
      <div {...handleProps('ne', { top: 0, right: 0, width: T, height: T, cursor: 'nesw-resize' })} />
      <div {...handleProps('sw', { bottom: 0, left: 0, width: T, height: T, cursor: 'nesw-resize' })} />
      <div
        {...handleProps('se', {
          bottom: 0,
          right: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
          // The bottom-right corner also gets a visible wedge — the affordance
          // people look for. The other seven handles are invisible but present.
          background:
            'linear-gradient(135deg, transparent 50%, var(--color-border) 50%, var(--color-border) 100%)',
        })}
      />
        </>
      )}
    </section>
  )
}

/**
 * A small icon button for the floating panel's title bar.
 *
 * @param label - Accessible name (the glyph alone means nothing to a screen
 *                reader) and the hover tooltip.
 * @param onClick - Action to run.
 * @param children - The glyph.
 */
function FloatButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      // The title bar is a drag handle, so swallow the pointer-down here or
      // clicking a button would start dragging the window instead.
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        font: 'inherit',
        fontSize: '0.85rem',
        lineHeight: 1,
        cursor: 'pointer',
        background: 'none',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        color: 'var(--color-text-muted)',
        padding: '2px 6px',
      }}
    >
      {children}
    </button>
  )
}
