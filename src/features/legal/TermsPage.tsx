/**
 * TermsPage — terms of service (Phase 7.2.2).
 *
 * Deliberately short and readable. Length is not protection: a document nobody
 * finishes is one nobody agreed to in any meaningful sense, and the parts that
 * actually matter here are few — what you may store, who owns it, what we may
 * do about abuse, and what happens when you stop paying.
 *
 * Claims kept consistent with the code:
 *   * DM-only vs player visibility — the RLS policies, not UI gating.
 *   * Read-only on lapse and 3-month deletion — see RefundsPage's header note;
 *     THE DELETION PART IS NOT BUILT YET and this page must not be published
 *     before it is.
 *   * Account deletion cascade — supabase/functions/delete-account.
 *   * No campaign ownership transfer — stated because it is a real, surprising
 *     consequence of a DM deleting their account.
 *
 * NOT LEGAL ADVICE and not a substitute for review: this is a drafted document
 * describing how the system behaves. Have a lawyer read it before it binds
 * anyone, particularly the liability and indemnity sections.
 */
import { LegalLayout, LegalSection } from './LegalLayout'
import { ENTITY_DISPLAY, ENTITY_JURISDICTION } from './legalConfig'

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <p>
        These terms are the agreement between you and {ENTITY_DISPLAY} for your
        use of TableTopChaos. Please read them; they are deliberately short.
      </p>

      <LegalSection heading="Who may use it">
        <p>
          You must be at least 13 years old, and at least 16 where local law sets
          a higher age for agreeing to online services without a parent or
          guardian. If you are using it on behalf of an organisation, you confirm
          you may agree to these terms for it.
        </p>
        <p>
          You are responsible for what happens under your account, so keep your
          password to yourself.
        </p>
      </LegalSection>

      <LegalSection heading="Your content stays yours">
        <p>
          Everything you write and upload remains yours. We claim no ownership of
          your campaigns, characters, notes or images.
        </p>
        <p>
          You give us only the permission needed to run the service: to store your
          content, and to show it to the people you have shared it with — the
          other members of your campaigns. That permission ends when you delete
          the content or your account, apart from copies in backups, which age out
          within 14 days.
        </p>
      </LegalSection>

      <LegalSection heading="What you may not do">
        <ul>
          <li>Upload anything unlawful, or anything you do not have the right to use.</li>
          <li>Upload sexual content involving minors, or content that harasses or threatens someone. This is the one thing that will get an account removed without warning.</li>
          <li>Attempt to access campaigns or accounts that are not yours.</li>
          <li>Interfere with the service, or work around its limits.</li>
          <li>Resell access to the service.</li>
        </ul>
        <p>
          Campaign members can report an uploaded image for review. A reported
          image is hidden immediately pending a decision by the campaign's DM.
        </p>
      </LegalSection>

      <LegalSection heading="Campaigns, DMs and players">
        <p>
          A campaign belongs to the DM who created it. Some material — DM notes,
          session logs, NPC rosters, encounters and quests — is visible only to
          the DM. A player's journal is private to that player.
        </p>
        <p>
          <strong>There is no way to transfer a campaign to another DM.</strong> If
          a DM deletes their account, their campaigns are deleted for everyone in
          them. If you are a player and this matters to you, export what you care
          about.
        </p>
      </LegalSection>

      <LegalSection heading="Paying, and not paying">
        <p>
          Paid plans, the free trial, refunds and cancellation are covered in{' '}
          <strong>Refunds &amp; Cancellation</strong>, which forms part of these
          terms.
        </p>
        <p>
          In short: a campaign with no active subscription becomes read-only —
          readable by everyone, writable by nobody — and is deleted after three
          months of that, with warnings first. You can export at any time,
          including while read-only.
        </p>
      </LegalSection>

      <LegalSection heading="Availability">
        <p>
          We will try to keep the service running and your data safe, but we do
          not promise it will be uninterrupted or error-free. We may change or
          discontinue features. If we discontinue the service altogether, we will
          give reasonable notice so you can export your campaigns.
        </p>
        <p>
          <strong>Keep your own copies of anything you cannot bear to lose.</strong>{' '}
          The export tools exist for this, and using them is the single most
          effective thing you can do to protect your work.
        </p>
      </LegalSection>

      <LegalSection heading="Ending the agreement">
        <p>
          You can stop using TableTopChaos at any time and delete your account
          from your profile page. We may suspend or close an account that breaks
          these terms; except for serious cases such as the content prohibited
          above, we will tell you why and give you a chance to respond.
        </p>
      </LegalSection>

      <LegalSection heading="Liability">
        <p>
          The service is provided as it is. To the extent the law allows, we are
          not liable for indirect or consequential loss, or for lost data or lost
          profits, and our total liability for any claim is limited to what you
          paid us in the twelve months before it arose.
        </p>
        <p>
          Nothing here limits liability that cannot be limited by law, including
          for fraud, or for death or personal injury caused by negligence. Some
          jurisdictions do not allow some of these limits, in which case they
          apply only as far as permitted.
        </p>
      </LegalSection>

      <LegalSection heading="Governing law">
        <p>
          These terms are governed by the laws of {ENTITY_JURISDICTION}, and
          disputes will be handled by the courts there — except where the law
          where you live gives you the right to bring a claim locally, which these
          terms do not take away.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to these terms">
        <p>
          If we make a material change we will ask you to accept the updated terms
          in the app. The version you accepted and the date is recorded on your
          account and shown on your profile page. If you do not accept an update
          you can stop using the service and delete your account.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
