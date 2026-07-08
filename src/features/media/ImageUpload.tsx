/**
 * ImageUpload — the reusable image-upload control for the Phase 1.6 media
 * pipeline. Consumed by portrait/encounter/handout features (Phase 2+).
 *
 * Responsibilities (client side):
 *  - Accept a file via drag-and-drop or click-to-browse.
 *  - Pre-validate type + size for instant feedback (the Edge Function re-checks
 *    authoritatively by magic bytes; this is just UX).
 *  - Show a local preview, an uploading state, and clear errors for
 *    too-large / wrong-type / over-cap / read-only / blocked results.
 *  - Delegate the actual validate/process/moderate/store to `uploadMedia`, then
 *    hand the created asset (+ signed URLs) back via `onUploaded`.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { Button, FormError, FormNotice } from '../../components/ui'
import { ACCEPTED_IMAGE_TYPES, uploadMedia, type UploadResult } from './api'

/**
 * @param campaignId - Campaign the upload belongs to (for cap/entitlement + path).
 * @param onUploaded - Called with the created asset + signed URLs on success.
 * @param label - Optional heading shown above the dropzone.
 * @param disabled - Disable the control (e.g. while a parent form is busy).
 */
export function ImageUpload({
  campaignId,
  onUploaded,
  label = 'Upload an image',
  disabled = false,
}: {
  campaignId: string
  onUploaded?: (result: UploadResult) => void
  label?: string
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  // Revoke the object URL when the preview changes/unmounts (avoid leaks).
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  /**
   * Validates then uploads a single file.
   * @param file - The chosen file.
   */
  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      setNotice(null)

      // --- Client-side pre-validation (fast reject; server re-checks). ---
      // Type only: size/dimensions are handled by uploadMedia, which downscales
      // oversized images client-side before the server's 10 MB / pixel checks.
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        setError('Unsupported file type. Use PNG, JPEG, WebP, or GIF.')
        return
      }

      // Show a local preview immediately.
      const url = URL.createObjectURL(file)
      setPreview(url)

      setBusy(true)
      try {
        const result = await uploadMedia(campaignId, file)
        setNotice('Uploaded.')
        onUploaded?.(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setBusy(false)
      }
    },
    [campaignId, onUploaded],
  )

  /** File input change handler. */
  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
    // Reset so selecting the same file again re-triggers change.
    e.target.value = ''
  }

  /** Drop handler. */
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (disabled || busy) return
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  const interactive = !disabled && !busy

  return (
    <div>
      {label && <div style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>{label}</div>}

      <div
        role="button"
        tabIndex={interactive ? 0 : -1}
        aria-disabled={!interactive}
        onClick={() => interactive && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (interactive && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (interactive) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-6)',
          minHeight: 140,
          textAlign: 'center',
          cursor: interactive ? 'pointer' : 'not-allowed',
          opacity: interactive ? 1 : 0.6,
          border: `2px dashed ${dragging ? 'var(--color-accent)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius)',
          background: dragging ? 'var(--color-surface)' : 'var(--color-bg)',
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt="Selected preview"
            style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 'var(--radius)' }}
          />
        ) : (
          <>
            <div style={{ fontSize: '1.5rem' }} aria-hidden>
              🖼️
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              {busy ? 'Uploading…' : 'Drag an image here, or click to browse'}
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
              PNG, JPEG, WebP, or GIF · large images are resized automatically
            </div>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          onChange={onInputChange}
          disabled={!interactive}
          style={{ display: 'none' }}
        />
      </div>

      {busy && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: 'var(--space-2)' }}>
          Processing and uploading…
        </p>
      )}
      {preview && !busy && (
        <Button
          variant="secondary"
          style={{ width: 'auto', marginTop: 'var(--space-3)' }}
          onClick={() => {
            setPreview(null)
            setError(null)
            setNotice(null)
          }}
        >
          Choose a different image
        </Button>
      )}

      <div style={{ marginTop: 'var(--space-3)' }}>
        <FormError message={error} />
        <FormNotice message={notice} />
      </div>
    </div>
  )
}
