/**
 * legal/legalConfig.ts — the few facts the policy documents cannot be written
 * without, in one place (Phase 7.2).
 *
 * Owns: the contracting entity, the contact address for legal/privacy requests,
 * the current policy version, and its effective date. The policy PROSE lives in
 * the page components; only the details that change independently of the wording
 * live here.
 *
 * WHY A GUARD RATHER THAN PLACEHOLDER TEXT. Two of these were unknown when the
 * documents were drafted (2026-08-24): there is no LLC formed yet and no domain,
 * so no contact address on it. Leaving `[TBD]` in the prose would eventually ship
 * — placeholders are invisible once you have read a page twice. Instead the
 * values are null, `isLegalConfigComplete()` reports it, and every policy page
 * renders a loud unmissable banner until they are filled in.
 *
 * To finish: set ENTITY_NAME and CONTACT_EMAIL below. Nothing else needs
 * touching, and the banners disappear on their own.
 */

/**
 * The legal entity that contracts with users. NULL until the LLC exists.
 *
 * Naming an entity that has not been formed is worse than naming a person: the
 * agreement would be with a party that does not exist, which is arguably no
 * agreement at all. Until it is registered, either fill in a personal name or do
 * not publish.
 */
export const ENTITY_NAME: string | null = null

/** Registered state/jurisdiction. Decided 2026-08-24. */
export const ENTITY_JURISDICTION = 'Utah, United States'

/**
 * Where privacy, deletion and legal requests go. NULL until a domain exists.
 *
 * This must be an address that is actually monitored — a privacy policy naming a
 * dead mailbox turns a GDPR/CCPA request into a missed deadline. Note the Resend
 * blocker in PRE_LAUNCH: until a sending domain is verified, outbound mail only
 * reaches the account owner's address.
 */
export const CONTACT_EMAIL: string | null = null

/**
 * Current policy version. **Bump on any MATERIAL change** — anything that alters
 * what you may do with someone's data, what they are agreeing to, or what they
 * are charged. Typo fixes and reformatting are not material and must NOT bump
 * it, or every user gets re-prompted for nothing and the prompt stops meaning
 * anything.
 *
 * Compared against profiles.legal_version_accepted (migration 0035) to decide
 * who needs re-prompting.
 */
export const POLICY_VERSION = '2026-08-24'

/** Human-readable effective date shown at the top of each document. */
export const POLICY_EFFECTIVE_DATE = '24 August 2026'

/**
 * Whether the policies are safe to present as binding.
 *
 * False while the entity or contact address is unknown. The pages stay reachable
 * either way — a draft you can read is more useful than a 404 — but they say
 * plainly that they are not yet in force.
 */
export function isLegalConfigComplete(): boolean {
  return Boolean(ENTITY_NAME && CONTACT_EMAIL)
}

/** What to call the operator in prose, before the entity exists. */
export const ENTITY_DISPLAY = ENTITY_NAME ?? 'the operator of TableTopChaos'

/** Contact address for prose, before a real mailbox exists. */
export const CONTACT_DISPLAY = CONTACT_EMAIL ?? '(contact address not yet published)'
