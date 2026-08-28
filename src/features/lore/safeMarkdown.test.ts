/**
 * Tests for the safe-markdown renderer.
 *
 * This is a SECURITY boundary, not a formatting nicety: lore is written by a
 * player and rendered into the DM's browser with `dangerouslySetInnerHTML`. If
 * anything author-supplied survives as markup, a player can run script in the
 * DM's session.
 *
 * So the tests are weighted accordingly — the formatting cases are here to stop
 * regressions, the escaping cases are here to stop an account takeover.
 */
import { describe, expect, it } from 'vitest'
import { renderSafeMarkdown } from './safeMarkdown'

describe('renderSafeMarkdown — escaping (the security-critical half)', () => {
  it('neutralises a script tag', () => {
    const out = renderSafeMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script&gt;')
  })

  it('neutralises an img onerror handler', () => {
    const out = renderSafeMarkdown('<img src=x onerror=alert(1)>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('escapes ampersands without double-escaping the entities it produces', () => {
    // If & were escaped AFTER < and >, "&lt;" would become "&amp;lt;" and the
    // output would show literal entity text to the reader.
    expect(renderSafeMarkdown('Tom & Jerry')).toContain('Tom &amp; Jerry')
    expect(renderSafeMarkdown('<b>')).toContain('&lt;b&gt;')
    expect(renderSafeMarkdown('<b>')).not.toContain('&amp;lt;')
  })

  it('escapes double quotes, so text cannot break out of an attribute', () => {
    expect(renderSafeMarkdown('say "hi"')).toContain('&quot;hi&quot;')
  })

  it('emits no anchor even when the author writes markdown link syntax', () => {
    // Links are deliberately unsupported; the syntax must render as text.
    const out = renderSafeMarkdown('[click](javascript:alert(1))')
    expect(out).not.toContain('<a')
    expect(out).not.toContain('href')
  })

  it('leaves a raw javascript: URL as inert text', () => {
    expect(renderSafeMarkdown('javascript:alert(1)')).not.toContain('<a')
  })

  it('produces ONLY the tags this module emits', () => {
    const out = renderSafeMarkdown(
      '**b** *i* `c`\n<script>x</script>\n<iframe></iframe>\n[l](u)\n<div onclick="x">',
    )
    const tags = [...out.matchAll(/<\/?([a-z]+)/gi)].map((m) => m[1].toLowerCase())
    expect(new Set(tags)).toEqual(new Set(['p', 'br', 'strong', 'em', 'code']))
  })
})

describe('renderSafeMarkdown — formatting', () => {
  it('renders bold', () => {
    expect(renderSafeMarkdown('**loud**')).toContain('<strong>loud</strong>')
  })

  it('renders italic', () => {
    expect(renderSafeMarkdown('*soft*')).toContain('<em>soft</em>')
  })

  it('prefers bold over italic for a double marker', () => {
    const out = renderSafeMarkdown('**both**')
    expect(out).toContain('<strong>both</strong>')
    expect(out).not.toContain('<em>')
  })

  it('renders inline code', () => {
    expect(renderSafeMarkdown('`2d6`')).toContain('<code>2d6</code>')
  })

  it('escapes inside code spans too', () => {
    // A code span must not become a hole in the escaping.
    expect(renderSafeMarkdown('`<script>`')).toContain('&lt;script&gt;')
  })

  it('splits paragraphs on a blank line', () => {
    const out = renderSafeMarkdown('one\n\ntwo')
    expect(out.match(/<p>/g)).toHaveLength(2)
  })

  it('turns a single newline into a line break, not a paragraph', () => {
    const out = renderSafeMarkdown('one\ntwo')
    expect(out).toContain('<br')
    expect(out.match(/<p>/g)).toHaveLength(1)
  })

  it('normalises CRLF', () => {
    expect(renderSafeMarkdown('one\r\n\r\ntwo').match(/<p>/g)).toHaveLength(2)
  })
})

describe('renderSafeMarkdown — empty input', () => {
  it.each(['', '   ', '\n\n', '\t'])('returns empty string for %j', (input) => {
    expect(renderSafeMarkdown(input)).toBe('')
  })
})
