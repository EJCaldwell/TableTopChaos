/**
 * shared/SharedPanel.tsx — the two faces of the Phase 4.1 DM→player channel:
 *
 *   * HandoutsPanel (DM, "Handouts" tab) — compose and share notes/images to the
 *     party, then manage what's currently shared (edit a note's title/body or an
 *     image's caption inline, and un-share).
 *   * SharedWithUsPanel (player, "Shared with us" tab) — a read-only feed of
 *     everything the DM has shared, newest first.
 *
 * Both read the same `shared_items` rows (RLS: members read, DM writes). The
 * read-only presentation is shared via <SharedItemCard>. Note bodies render
 * through the same XSS-safe markdown subset as character lore.
 */
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { AutoTextarea, Button, FormError } from '../../components/ui'
import { useAutosave, SaveIndicator } from '../dm/autosave'
import { useRealtimeSync, type RealtimeEvent } from '../realtime/useRealtimeRefresh'
import { renderSafeMarkdown } from '../lore/safeMarkdown'
import { ImageUpload } from '../media/ImageUpload'
import {
  listSharedItems,
  resolveSharedItem,
  shareImage,
  shareNote,
  unshareItem,
  updateSharedItem,
  type ResolvedSharedItem,
  type SharedItem,
} from './sharedApi'

/**
 * Applies one Realtime shared_items event to a panel's item list: DELETE drops
 * the row, INSERT prepends (newest-first, matching listSharedItems), UPDATE
 * replaces in place. Images are re-resolved to a fresh signed URL. Shared by the
 * DM and player panels so both stay live without a full re-fetch.
 */
async function applySharedEvent(
  setItems: Dispatch<SetStateAction<ResolvedSharedItem[]>>,
  e: RealtimeEvent<SharedItem>,
) {
  if (e.eventType === 'DELETE') {
    const oldId = (e.old as { id?: string }).id
    if (oldId) setItems((prev) => prev.filter((i) => i.id !== oldId))
    return
  }
  const resolved = await resolveSharedItem(e.new)
  setItems((prev) => {
    const idx = prev.findIndex((i) => i.id === resolved.id)
    if (idx === -1) return [resolved, ...prev]
    const copy = prev.slice()
    copy[idx] = resolved
    return copy
  })
}

// ===========================================================================
// Shared read-only card (used by both the player feed and the DM's manage list)
// ===========================================================================

/**
 * SharedItemCard — read-only render of one shared item. A note shows its title
 * (if any) and markdown body; an image shows its caption and the picture (with a
 * graceful placeholder when the asset is unavailable / not yet approved).
 * @param item - The resolved shared item to display.
 */
function SharedItemCard({ item }: { item: ResolvedSharedItem }) {
  return (
    <article
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        background: 'var(--color-bg)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      {item.title.trim() && <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{item.title}</h3>}
      {item.type === 'note' ? (
        item.body.trim() ? (
          <div
            style={{ fontSize: '0.95rem', lineHeight: 1.5 }}
            // Safe: renderSafeMarkdown HTML-escapes all author text before adding
            // only its own fixed tags (see lore/safeMarkdown.ts).
            dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(item.body) }}
          />
        ) : (
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>(empty note)</p>
        )
      ) : item.fullUrl ? (
        <a href={item.fullUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block' }}>
          <img
            src={item.fullUrl}
            alt={item.title || 'Shared image'}
            style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }}
          />
        </a>
      ) : (
        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
          Image unavailable{item.moderationStatus && item.moderationStatus !== 'approved' ? ` (${item.moderationStatus})` : ''}.
        </div>
      )}
    </article>
  )
}

// ===========================================================================
// Player view — "Shared with us"
// ===========================================================================

/**
 * SharedWithUsPanel — the player-facing read-only feed of what the DM has
 * shared. No write controls; RLS wouldn't allow them anyway.
 * @param campaignId - The campaign whose shared items to show.
 */
export function SharedWithUsPanel({ campaignId }: { campaignId: string }) {
  const [items, setItems] = useState<ResolvedSharedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await listSharedItems(campaignId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shared items.')
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live: merge share changes row-by-row (no full re-fetch) for this campaign.
  useRealtimeSync<SharedItem>(
    'shared_items',
    (e) => void applySharedEvent(setItems, e),
    `campaign_id=eq.${campaignId}`,
  )

  return (
    <section style={{ marginTop: 'var(--space-6)' }}>
      <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Shared with us</h2>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Handouts, images, and notes your DM has shared with the party.
      </p>
      <FormError message={error} />
      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-4)' }}>
          Nothing shared yet. When your DM shares a handout, it'll show up here.
        </p>
      ) : (
        <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {items.map((item) => (
            <SharedItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}

// ===========================================================================
// DM view — "Handouts" (compose + manage)
// ===========================================================================

/**
 * HandoutsPanel — the DM's share composer + management list. Share a note
 * (title + markdown) or upload an image; then edit or un-share anything already
 * shared. Every shared row is instantly visible to all players.
 * @param campaignId - The campaign to share into.
 */
export function HandoutsPanel({ campaignId }: { campaignId: string }) {
  const [items, setItems] = useState<ResolvedSharedItem[]>([])
  const [loading, setLoading] = useState(true)
  // Note composer draft (title + body).
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')

  const { saveState, error, setError, runSave, scheduleSave } = useAutosave()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await listSharedItems(campaignId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shared items.')
    } finally {
      setLoading(false)
    }
  }, [campaignId, setError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live: merge share changes row-by-row (no full re-fetch) for this campaign.
  useRealtimeSync<SharedItem>(
    'shared_items',
    (e) => void applySharedEvent(setItems, e),
    `campaign_id=eq.${campaignId}`,
  )

  /** Shares the composer's note, then clears the draft and prepends it. */
  async function handleShareNote() {
    if (!draftTitle.trim() && !draftBody.trim()) {
      setError('Add a title or some text before sharing a note.')
      return
    }
    await runSave(async () => {
      const row = await shareNote(campaignId, draftTitle.trim(), draftBody)
      setItems((prev) => [{ ...row, fullUrl: null, thumbUrl: null, moderationStatus: null }, ...prev])
      setDraftTitle('')
      setDraftBody('')
    })
  }

  /**
   * Handles a completed image upload: records the share and prepends it using
   * the URLs the upload already returned (no re-fetch needed).
   */
  async function handleImageUploaded(assetId: string, fullUrl: string | null, thumbUrl: string | null) {
    await runSave(async () => {
      const row = await shareImage(campaignId, assetId, '')
      setItems((prev) => [
        { ...row, fullUrl, thumbUrl: thumbUrl ?? fullUrl, moderationStatus: 'approved' },
        ...prev,
      ])
    })
  }

  /** Edits a shared item's title (both types) — debounced. */
  function handleTitleChange(id: string, title: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, title } : it)))
    scheduleSave(`title-${id}`, () => updateSharedItem(id, { title }))
  }

  /** Edits a note's body — debounced. */
  function handleBodyChange(id: string, body: string) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, body } : it)))
    scheduleSave(`body-${id}`, () => updateSharedItem(id, { body }))
  }

  /** Un-shares (deletes) an item after confirmation. */
  async function handleUnshare(id: string) {
    if (!window.confirm('Un-share this? It will disappear for all players.')) return
    const prev = items
    setItems((cur) => cur.filter((it) => it.id !== id))
    await runSave(() => unshareItem(id)).catch(() => setItems(prev))
  }

  return (
    <section style={{ marginTop: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Handouts</h2>
        <SaveIndicator state={saveState} />
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 'var(--space-2)' }}>
        Share notes and images with the whole party. Anything here is visible to
        every player; un-share to take it back.
      </p>

      <FormError message={error} />

      {/* Composer: share a note. */}
      <div style={{ marginTop: 'var(--space-4)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Share a note</h3>
        <input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          maxLength={200}
          placeholder="Title (optional)"
          aria-label="Note title"
          style={{ font: 'inherit', fontWeight: 600, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }}
        />
        <AutoTextarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          minRows={3}
          maxRows={12}
          placeholder="Write a handout… (supports **bold**, *italic*, and `code`)"
          aria-label="Note body"
          style={{ font: 'inherit', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }}
        />
        <Button onClick={handleShareNote} style={{ width: 'auto', alignSelf: 'flex-start' }}>Share note</Button>
      </div>

      {/* Composer: share an image. Upload immediately shares it. */}
      <div style={{ marginTop: 'var(--space-3)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-4)' }}>
        <h3 style={{ margin: '0 0 var(--space-2)', fontSize: '1rem' }}>Share an image</h3>
        <ImageUpload
          campaignId={campaignId}
          label="Upload an image to share"
          onUploaded={(result) => void handleImageUploaded(result.asset.id, result.originalUrl, result.thumbUrl)}
        />
      </div>

      {/* Currently shared. */}
      <h3 style={{ margin: 'var(--space-6) 0 var(--space-2)', fontSize: '1rem' }}>Currently shared</h3>
      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Nothing shared yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', background: 'var(--color-surface)', padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input
                  value={item.title}
                  onChange={(e) => handleTitleChange(item.id, e.target.value)}
                  maxLength={200}
                  placeholder={item.type === 'image' ? 'Caption (optional)' : 'Title (optional)'}
                  aria-label="Shared item title"
                  style={{ flex: 1, font: 'inherit', fontWeight: 600, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-2)', color: 'var(--color-text)' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.type}</span>
                <button onClick={() => void handleUnshare(item.id)} title="Un-share" aria-label="Un-share" style={{ font: 'inherit', fontSize: '0.85rem', background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-danger)', borderRadius: 'var(--radius)', padding: 'var(--space-1) var(--space-3)', cursor: 'pointer', whiteSpace: 'nowrap' }}>Un-share</button>
              </div>
              {item.type === 'note' ? (
                <AutoTextarea
                  value={item.body}
                  onChange={(e) => handleBodyChange(item.id, e.target.value)}
                  minRows={2}
                  maxRows={12}
                  placeholder="Note text… (**bold**, *italic*, `code`)"
                  aria-label="Shared note body"
                  style={{ font: 'inherit', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', color: 'var(--color-text)' }}
                />
              ) : item.thumbUrl ? (
                <img src={item.thumbUrl} alt={item.title || 'Shared image'} style={{ maxWidth: 200, maxHeight: 200, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)' }} />
              ) : (
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                  Image unavailable{item.moderationStatus && item.moderationStatus !== 'approved' ? ` (${item.moderationStatus})` : ''}.
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
