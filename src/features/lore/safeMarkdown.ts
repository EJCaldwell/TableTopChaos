/**
 * safeMarkdown.ts — a tiny, XSS-safe markdown-subset renderer for character lore.
 *
 * Why this exists: lore fields (backstory/appearance/personality) are authored by
 * a PLAYER and viewed by the DM. If we stored/rendered raw HTML, a player could
 * inject <script> (or event handlers) that runs in the DM's browser. So we store
 * PLAIN TEXT and render a fixed, safe formatting subset here:
 *   1. HTML-escape the entire source first (so any literal < > & " the player
 *      typed becomes inert text, never markup),
 *   2. THEN apply our own known-safe tags for a small markdown subset.
 * Because escaping happens before any tag insertion, the only tags in the output
 * are the ones this function emits — there is no path for author-supplied HTML.
 *
 * Supported: **bold**, *italic*, `code`, blank-line paragraphs, single-line
 * breaks. Intentionally NOT supported: links/images/raw HTML (all would widen
 * the safety surface for little MVP value).
 */

/**
 * Escapes the HTML-significant characters so author text can never introduce
 * markup. Order matters: `&` must be escaped first or it would double-escape the
 * entities produced by the later replacements.
 * @param s - Raw author text.
 * @returns The text with &, <, >, " replaced by entities.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Applies inline formatting to an ALREADY-ESCAPED line. Safe because it only
 * wraps text in fixed tags; the `*` / `` ` `` markers are plain text (never
 * escaped away) and the content between them was escaped upstream.
 *  - `**x**` → <strong>x</strong>  (run first so it wins over single-*)
 *  - `*x*`   → <em>x</em>
 *  - `` `x` `` → <code>x</code>
 * @param line - One escaped line of text.
 * @returns The line with inline formatting tags applied.
 */
function applyInline(line: string): string {
  return line
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

/**
 * Renders a safe-markdown-subset source string to an HTML string suitable for
 * dangerouslySetInnerHTML. Blank lines separate paragraphs; single newlines
 * within a paragraph become <br>. Returns '' for empty/whitespace-only input.
 * @param src - The stored plain-text lore.
 * @returns Sanitized HTML (only tags this module emits).
 */
export function renderSafeMarkdown(src: string): string {
  if (!src.trim()) return ''
  // Normalize newlines, escape everything, then split into paragraphs on one or
  // more blank lines.
  const escaped = escapeHtml(src.replace(/\r\n/g, '\n'))
  const paragraphs = escaped.split(/\n{2,}/)
  return paragraphs
    .map((para) => {
      const withBreaks = para
        .split('\n')
        .map((line) => applyInline(line))
        .join('<br>')
      return `<p>${withBreaks}</p>`
    })
    .join('')
}
