# QA 7.2 — Legal & policy pages

Covers [PLANNING.md](../../PLANNING.md) subphase 7.2: Terms of Service, Privacy
Policy, Refunds & Cancellation, versioned acceptance, and the signup consent.

**Decisions taken 2026-08-24 (user):** 14-day money-back guarantee · lapsed
campaigns deleted after 3 months (PLANNING's original design) · minimum age 13,
16 where local law requires · Utah, USA, contracting through an LLC.

> **These documents are NOT legal advice and have not been reviewed by a lawyer.**
> They are drafts describing how the system actually behaves. Have them reviewed
> before they bind anyone — particularly the liability and indemnity sections of
> the Terms.

---

## Area A — Built

| Piece | Where |
|---|---|
| Versioned acceptance columns + RPC | migration `0035_legal_acceptance.sql` |
| Entity/contact/version config | `src/features/legal/legalConfig.ts` |
| Terms of Service | `src/features/legal/TermsPage.tsx` → `/legal/terms` |
| Privacy Policy | `src/features/legal/PrivacyPage.tsx` → `/legal/privacy` |
| Refunds & Cancellation | `src/features/legal/RefundsPage.tsx` → `/legal/refunds` |
| Signup consent checkbox | `src/features/auth/SignUpPage.tsx` |
| Re-prompt on missing/outdated acceptance | `src/features/legal/LegalAcceptanceBanner.tsx`, mounted in `RequireAuth` |
| Links + recorded acceptance | Profile → Legal |

**Routes are outside the auth guard**, deliberately: a prospective user must be
able to read the terms before signing up, and a departing one after their account
is gone.

**Acceptance is recorded through an RPC, not a profile UPDATE**, so the timestamp
is stamped server-side. A client-supplied timestamp is worthless as evidence — it
is the one field a user could backdate, and the one that matters if acceptance is
ever disputed.

---

## Area B — BLOCKERS: this cannot be published yet

Three things, and none is cosmetic.

### 1. The 3-month deletion described in the Refunds page **does not exist**

The user chose the lapse → read-only → 3-month-deletion lifecycle. Searching
`supabase/migrations`, `supabase/functions` and `src` on 2026-08-24 found **no
cleanup cron, no deletion job, no warning emails, no in-app countdown**. What
exists today is only the read-only half, and even that is dormant because
`enforce_active` is `false`.

So the Refunds page currently promises:

> A campaign that has been read-only for three months is permanently deleted …
> We email the campaign's owner 30 days, 7 days and 1 day before that happens.

None of which happens. **Publishing that is a false statement in a legal
document**, and the failure mode is the worst kind: someone's campaign deleted
after a warning that was never sent, or — equally bad — a promise of deletion
that never occurs while a user believes their data is gone.

**Dependency chain, in order:** verify a Resend domain (otherwise warning emails
reach only the account owner) → build the cleanup Edge Function + cron →
build the in-app countdown → QA the deletion path against fixtures → *then*
publish.

### 2. No legal entity

`ENTITY_NAME` is `null` because the LLC does not exist yet. Naming an entity that
has not been formed is worse than naming a person: the agreement would be with a
party that does not exist. Either form it, or publish under a personal name.

### 3. No contact address

`CONTACT_EMAIL` is `null` — there is no domain yet. A privacy policy naming a dead
mailbox turns a GDPR/CCPA request into a missed deadline.

**How these are enforced rather than remembered:** `isLegalConfigComplete()`
returns false while either is unset, every policy page renders a prominent
**"DRAFT — not in force, do not publish"** banner naming exactly what is missing,
and the acceptance banner does not appear at all. Asking users to agree to a
document that says it is not in force would make the acceptance record
worthless. Filling in the two constants clears all of it automatically.

---

## Area C — Automated verification (Claude) — **PASS**

| Check | Result |
|---|---|
| `npm run build` | clean |
| Migration 0035 applied via the migrate job | `1 new, 33 already recorded` |
| Grant sweep / RLS / function-privilege / erasure guards | all OK |
| `record_legal_acceptance` as **anon** | **401** `42501 permission denied` |
| `record_legal_acceptance` as authenticated | **204**, row written |
| Timestamp written server-side | `legal_accepted_at` populated by the RPC |

The RPC is granted to `authenticated` and revoked from `anon`/`PUBLIC` **by
name** — per migration 0031, `revoke … from public` alone does not restrict a
function here. It is deliberately **not** on the service-role-only list in the
grant sweep: it reads `auth.uid()` and can only touch the caller's own row, so
`authenticated` is exactly the right grant.

The test acceptance written to the developer's own account during verification
was cleared afterwards — recording agreement to a draft would be a false record.

---

## Area D — Content accuracy review

Every factual claim in the documents traces to code. Verified 2026-08-24:

| Claim | Source |
|---|---|
| 30-day trial, one per card | `TRIAL_PERIOD_DAYS`; card-fingerprint check in `stripe-webhook` |
| Cancel keeps access to period end | Stripe `cancel_at_period_end` |
| Failed payment retried ~2–3 weeks, still usable | `private.campaign_is_active()` treats `past_due` as active (0005) |
| Read-only freezes writes for **everyone**, players included | same function returning false |
| Card details never reach the app | Stripe Checkout collects browser→Stripe; only brand/last4/fingerprint persisted |
| EXIF stripped from uploads | `upload-media` re-encodes to WebP |
| Card fingerprint retained after account deletion | `trial_redemptions` (0005), FK `SET NULL` |
| Hashed email retained after deletion | `deleted_accounts` (0032) |
| Backups keep 14 daily copies | `railway/backup`, `BACKUP_KEEP=14` |
| Deletion re-applied after a restore | `91_reapply_deletions.sql` |
| Account deletion cancels Stripe, removes uploads, cascades | `delete-account` |
| No campaign ownership transfer | no such path exists; stated because it surprises people |

**The one unverifiable claim is the 3-month deletion** — see Area B.

---

## Area E — Browser pass — **NOT STARTED**

Deliberately deferred until Area B's blockers are resolved: reviewing the wording
of a document that is about to change materially is wasted effort. When it runs
it should cover reachability while signed out, the signup checkbox gating
submission, acceptance appearing on the profile, and the re-prompt banner after a
`POLICY_VERSION` bump.
