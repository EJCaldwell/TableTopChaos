/**
 * AvatarSection — upload and preview your profile picture (Phase 7.3.1).
 *
 * `profiles.avatar_url` has existed since migration 0001 and nothing has ever
 * written to it. The 1.6 media pipeline unblocked this; only the upload path was
 * missing.
 *
 * WHAT avatar_url ACTUALLY HOLDS: a storage PATH inside the private `media`
 * bucket, not a URL. The bucket is private, so the only usable URL is a
 * short-lived signed one — storing that would mean storing something that
 * expires in an hour. Rendering therefore takes two steps: read the path from
 * the profile row, then sign it (migration 0038 is the read policy that lets
 * that succeed).
 *
 * The upload goes through `upload-media` with `scope: 'avatar'` rather than a
 * dedicated function, so it inherits the same gauntlet as campaign media —
 * magic-byte type checking, the pixel-count guard, EXIF/GPS stripping, WebP
 * re-encoding, and the moderation hook. The server derives the storage path from
 * the caller's JWT, so nothing here can target another user's avatar.
 *
 * WHO SEES IT: you, and anyone you share a campaign with — the same visibility
 * the profile row already had since 0004. That is stated in the UI, because
 * "who can see this picture" is not something anyone should have to infer.
 *
 * There is deliberately no "remove avatar" control yet. Clearing the column is
 * easy; deleting the stored object safely is the part that needs thought, and a
 * button that leaves the file behind while claiming otherwise is worse than no
 * button. Tracked as a follow-up rather than half-built.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Button, FormError, FormNotice } from '../../components/ui'
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_AVATAR_BYTES,
  MAX_AVATAR_LABEL,
  signedUrlFor,
  uploadAvatar,
} from '../media/api'

/** Rendered size of the preview, in px. Matches the stored 256px cap. */
const PREVIEW_PX = 96

/** Props for {@link AvatarSection}. */
interface AvatarSectionProps {
  /** Current value of profiles.avatar_url — a storage path, or null. */
  avatarPath: string | null
  /** Called with the new storage path after a successful upload. */
  onUploaded: (path: string) => void
}

/**
 * Avatar preview + upload control.
 * @param props - See {@link AvatarSectionProps}.
 */
export function AvatarSection({ avatarPath, onUploaded }: AvatarSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Resolve the stored path into a signed URL whenever it changes. Failures are
  // swallowed to a blank avatar: a profile page that errors out because a
  // picture could not be signed is a worse outcome than no picture.
  useEffect(() => {
    let active = true
    if (!avatarPath) {
      setUrl(null)
      return
    }
    signedUrlFor(avatarPath)
      .then((u) => {
        if (active) setUrl(u)
      })
      .catch(() => {
        if (active) setUrl(null)
      })
    return () => {
      active = false
    }
  }, [avatarPath])

  /**
   * Uploads the chosen file and reports the new path upward.
   * @param e - Change event from the hidden file input.
   */
  const handleChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      // Reset the input immediately so choosing the SAME file again still fires
      // a change event — otherwise a failed upload cannot be retried without
      // picking a different picture.
      e.target.value = ''
      if (!file) return

      setError(null)
      setNotice(null)

      // Client-side type check for instant feedback only. The server re-checks
      // by magic bytes, which is the check that actually counts — an extension
      // proves nothing about a file's contents.
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        setError('Choose a PNG, JPEG, WebP or GIF image.')
        return
      }
      // Size is checked again in uploadAvatar and authoritatively on the server;
      // catching it here is what makes the message appear instantly instead of
      // after a large file has been read and re-encoded.
      if (file.size > MAX_AVATAR_BYTES) {
        setError(
          `That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit ` +
            `for an avatar is ${MAX_AVATAR_LABEL}.`,
        )
        return
      }

      setBusy(true)
      try {
        const result = await uploadAvatar(file)
        setUrl(result.avatarUrl)
        onUploaded(result.avatarPath)
        setNotice('Avatar updated.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setBusy(false)
      }
    },
    [onUploaded],
  )

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
      <strong style={{ fontSize: '0.9rem' }}>Avatar</strong>
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
        {url ? (
          <img
            src={url}
            alt="Your avatar"
            width={PREVIEW_PX}
            height={PREVIEW_PX}
            style={{
              width: PREVIEW_PX,
              height: PREVIEW_PX,
              borderRadius: '50%',
              objectFit: 'cover',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
            }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              width: PREVIEW_PX,
              height: PREVIEW_PX,
              borderRadius: '50%',
              border: '1px dashed var(--color-border)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--color-text-muted)',
              fontSize: '0.75rem',
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            No avatar
          </div>
        )}

        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {/* A hidden input driven by a Button, so the control matches every
              other button on the page — a bare file input cannot be styled
              consistently across browsers. */}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            onChange={handleChange}
            style={{ display: 'none' }}
          />
          <Button
            variant="secondary"
            style={{ width: 'auto' }}
            busy={busy}
            onClick={() => inputRef.current?.click()}
          >
            {avatarPath ? 'Change avatar' : 'Upload avatar'}
          </Button>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
            PNG, JPEG, WebP or GIF, up to {MAX_AVATAR_LABEL}. Visible to you and
            to people you share a campaign with.
          </span>
        </div>
      </div>
      <FormError message={error} />
      <FormNotice message={notice} />
    </div>
  )
}
