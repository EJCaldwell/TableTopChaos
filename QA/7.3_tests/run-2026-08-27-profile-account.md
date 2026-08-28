# Run log — Profile & account management, 2026-08-27

**PASS — all areas.** Server-side and automated halves verified here; manual
areas A–D reported by the user on 2026-08-27. One bug found in area C (an error
box containing `{}`) and fixed. Two items remain blocked on the Resend sending
domain, and are recorded as NOT RUN rather than passed.

## Automated

- `npm run build` — clean throughout.
- `npm run qa:checks` — **62 passed, 0 failed** (was 53). Nine new checks cover
  `resetAllLayouts` / `selectLayoutKeys`; see
  [automated-coverage.md](automated-coverage.md).
- Migration **0038_avatar_storage.sql** applied via `railway up --service
  migrate`: `1 new, 36 already recorded`, grant sweep clean, RLS assertion clean,
  function-privilege assertion clean, erasure check clean.

## PASS — avatar access control (6/6)

The headline check for this subphase. Run as `authenticated` with
`request.jwt.claims` set, against synthetic `storage.objects` rows, inside a
rolled-back transaction.

Caller = `a1d42405…`, who shares two campaigns with `6c5f4c63…` and **none**
with `a900ec93…`.

| Assertion | Result |
|---|---|
| own avatar readable | PASS `rows=1` |
| co-member's avatar readable | PASS `rows=1` |
| **stranger's avatar NOT readable** | PASS `rows=0` |
| malformed path not readable, and does not raise | PASS `rows=0` |
| no regression — campaign media still readable by a member | PASS `rows=30` |
| **anon sees no avatar at all** | PASS `rows=0` |

The malformed-path case is there because `split_part` returns `''` for a bad
path and `''::uuid` **raises** rather than returning null — inside a policy that
surfaces as an opaque error on an unrelated read. The regex guard is what keeps
it to a clean "no rows".

The regression row matters too: policies on a table are OR-ed, so the new avatar
policy had to widen reads for `avatars/…` without touching what
`media_objects_read_members` admits.

## PASS — the deployed upload path (7/7)

Live HTTP against the production gateway with a manually minted HS256 JWT.

| Case | Result |
|---|---|
| no Authorization | **401** "Not signed in." |
| authed, no `scope` and no `campaignId` | **400** — not a silent avatar write |
| authed, `scope=avatar`, a text file renamed `.png` | **415** by magic bytes |
| authed, `scope=avatar`, real 900×600 PNG | **200**, path under `avatars/<own uid>/` |
| the returned signed URL | **200**, `image/webp`, **256×171** (aspect preserved) |
| a **GPS-tagged JPEG** | **200**, stored WebP with **0 EXIF tags, no GPS IFD** |
| a second upload | new random path; the **old signed URL now 400** (object deleted) |

Two of those are worth calling out.

**The EXIF check is the security-relevant one.** A phone photo carries the
coordinates it was taken at, and an avatar is the most likely image anyone
uploads straight from a camera roll. The fixture was built with real GPS tags
(`piexif`) and came back with none — this is why the avatar shares `upload-media`
instead of getting its own path, where the strip would be one thing to forget.

**Path derivation was verified, not assumed.** The stored path is built from the
JWT's `sub`, never from the request body, so a caller cannot write to another
user's avatar path.

## PASS — no orphaned storage

After **three** uploads by the same user, `storage.objects` held **exactly one**
`avatars/%` row. Replacement deletes the previous object, and it deletes it only
*after* the profile row points at the new one — the other order would leave a
broken avatar on failure; this order leaves an orphaned file, which costs bytes
and nothing else.

## Test data removed

The QA avatar object was deleted through the **storage API** (not by deleting the
`storage.objects` row, which would strand the file — that row is storage-api's
index, not the bytes), and `profiles.avatar_url` was set back to null. Verified:
zero `avatars/%` objects remain.

## BUG FOUND BY THE USER — email change showed `{}` (fixed)

Reported from area C: attempting an email change produced an error box
containing the literal string `{}`.

**Reproduced server-side.** `PUT /auth/v1/user` with a new address returns:

```
HTTP 500
{"code":500,"error_code":"unexpected_failure",
 "msg":"Error sending email change email","error_id":"bc731e76-…"}
```

So GoTrue's message was perfectly clear. CORS was ruled out as the cause — the
500 carries `access-control-allow-origin: *` exactly like a 200, so the browser
could read the body.

**The message was destroyed by `@supabase/auth-js` (2.110.0).** In
`handleError`, a status in `NETWORK_ERROR_CODES` — which includes **500** —
short-circuits *before* the body is parsed:

```js
if (NETWORK_ERROR_CODES.includes(error.status)) {
  throw new AuthRetryableFetchError(_getErrorMessage(error), error.status)
}
```

`error` there is the raw `Response`, not the parsed body. `_getErrorMessage`
looks for `.msg`/`.message`/`.error_description`/`.error` as strings, a
`Response` has none, and the fallback is `JSON.stringify(err)` — which for a
`Response` is `{}`. Confirmed in Node.

**This is not specific to email change.** *Any* 5xx from GoTrue surfaces as
`{}` — sign-up, sign-in and password reset included. A user hitting it at
sign-up would see an empty error box and have no idea whether an account was
created.

**Fix:** [src/features/auth/authErrors.ts](../../src/features/auth/authErrors.ts)
— `authErrorMessage(error, fallback)` replaces opaque messages (`{}`, empty,
`Failed to fetch`, `Load failed`) with a written fallback. Applied to all three
auth calls in `CredentialsSection`. The fallbacks state **what did not happen**
("your address has NOT been changed"), because that is the actionable part when
the server's reason is unavailable.

> **Follow-up, not done:** the same swap has NOT been applied to `SignUpPage`,
> `LoginPage`, `RequestPasswordResetPage` or `UpdatePasswordPage`. They can all
> still show `{}` on a 5xx.

**The underlying 500 is the Resend blocker**, not a code defect: the address
tested cannot receive mail from an unverified domain. Area C3 remains untestable
end to end until PRE_LAUNCH §3 is done.

## PASS — avatar size cap (added at the user's request)

`AVATAR_MAX_BYTES` = **5 MB**, a fifth of the 10 MB campaign-media limit.

Campaign media counts against a per-campaign storage cap; an avatar deliberately
does not, so before this nothing bounded how much a direct API caller could push
through that path. The tighter ceiling is what makes "no storage cap on avatars"
safe rather than an open door.

| Case | Result |
|---|---|
| 5.6 MB PNG as an avatar | **413** "That image is too large for an avatar (max 5 MB)." |
| the **same file** as campaign media | **200** — the 10 MB limit is unchanged |

Checked in three places: the UI (instant, names the actual file size),
`uploadAvatar` (before downscaling — otherwise a 60 MB file is decoded and
re-encoded in the browser only to be rejected), and the Edge Function (the
authority). The client measures the file the user *picked* and the server
measures what *arrived* after downscaling; since the latter is always smaller, a
file accepted by the client can never be rejected for size by the server.

The control upload this created in the test campaign was removed afterwards —
both storage objects through the storage API, then the `media_assets` row.

## PASS — manual areas A–D (user-reported, 2026-08-27)

**User's report: "everything else passes."** Recorded as observed, not inferred.

| Area | Result |
|---|---|
| **A** — reset all workspace layouts | PASS 1–5. Notably A4: the sidebar-position preference and each campaign's last-used tab both survived the reset. |
| **B** — change password | PASS 1–6, including B4 (still signed in afterwards) and B6 (new password works, old one rejected). |
| **C** — change email | C1, C2, C4 PASS. **C3 initially FAILED** — see the bug above — and now reports honestly. **C5 NOT RUN**, blocked on mail delivery. |
| **D** — avatar | PASS 1–5, plus D5b (the new 5 MB cap). D6 skipped by design: nothing renders co-member avatars yet. |

The DM account's avatar was left in place — it is the user's own, uploaded during
D2/D3, and `profiles.avatar_url` and the stored object agree.

### The one that mattered

**D3** (avatar survives a reload) is the check that separates "the upload
appeared to work" from "the path was saved and can be re-signed". A preview held
only in React state would have looked identical up to that point.

## Follow-up applied — `{}` swept from the remaining auth pages

At the user's request, `authErrorMessage` was applied to `SignUpPage`,
`LoginPage`, `RequestPasswordResetPage` and `UpdatePasswordPage`. Each fallback
names what did not happen, which is the actionable part:

- **Sign-up** — "no account was created". The worst place for an empty error box:
  without this, someone cannot tell whether to try again or to try signing in.
- **Sign-in** — says the failure looks like our side rather than their details,
  so a server fault does not send people off to reset a password that was never
  wrong.
- **Reset request** — "your password has not been changed". This page reports
  success even for unknown addresses, so the only errors reaching it are
  transport-level — exactly the ones reduced to `{}`.
- **Update password** — "your old password still works, and the reset link may
  have expired".

`npm run build` clean. Not separately QA'd in a browser: these are one-line
substitutions on paths whose success cases were already exercised, and
provoking a real 5xx on each would mean deliberately breaking the auth service.
The substitution itself is covered by the same helper verified in area C.
