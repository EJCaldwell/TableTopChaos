/**
 * PrivacyPage — privacy policy (Phase 7.2.2).
 *
 * Every claim here is traceable to something in this repo, deliberately. A
 * privacy policy describing data handling the code does not perform is worse
 * than none: it is a documented promise you are visibly breaking.
 *
 *   * What is stored — the 29 tables in supabase/migrations, plus the `media`
 *     bucket and GoTrue's auth schema.
 *   * Card data — stripe-webhook persists only brand/last4/fingerprint; raw card
 *     details go browser→Stripe and never reach this app (PLANNING, PCI note).
 *   * Deletion — supabase/functions/delete-account: cancels Stripe, removes the
 *     user's uploads, then deletes auth.users; 35 FKs cascade.
 *   * Retention after deletion — trial_redemptions (card fingerprint, migration
 *     0005) and deleted_accounts (hashed email, migration 0032) both deliberately
 *     survive erasure. Both are disclosed below because they must be.
 *   * Backups — railway/backup: 14 daily copies, whole database.
 *
 * Sub-processors are named rather than described vaguely, because "we may share
 * data with service providers" tells a reader nothing they can act on.
 */
import { LegalLayout, LegalSection } from './LegalLayout'
import { ENTITY_DISPLAY, ENTITY_JURISDICTION } from './legalConfig'

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        TableTopChaos is a note-taking app for tabletop roleplaying campaigns.
        This policy explains what we store, why, who else can see it, and how to
        get it back or get rid of it. It is operated by {ENTITY_DISPLAY} from{' '}
        {ENTITY_JURISDICTION}.
      </p>

      <LegalSection heading="What we store">
        <p>Because you asked us to, in order to run the app:</p>
        <ul>
          <li>
            <strong>Your account</strong> — email address, a password (stored only
            as a bcrypt hash, never in readable form), and a display name and
            avatar if you set one.
          </li>
          <li>
            <strong>What you write</strong> — campaigns, character sheets,
            inventories, spells, abilities, journals, NPCs, encounters, quests,
            session logs, DM notes, and scheduling.
          </li>
          <li>
            <strong>Images you upload</strong> — portraits, encounter art and
            handouts. Uploads are re-encoded on our servers, which strips EXIF
            metadata, so location and camera information embedded in a photo is
            removed before storage.
          </li>
          <li>
            <strong>Billing records</strong> — see the separate section below.
          </li>
        </ul>
        <p>
          We do not use analytics or advertising trackers, and we do not sell or
          share your data for advertising.
        </p>
      </LegalSection>

      <LegalSection heading="Payment data">
        <p>
          <strong>Card details never reach this app.</strong> Payment is handled by
          Stripe Checkout, which collects card data directly from your browser.
        </p>
        <p>We store only what we need to show you your own subscription:</p>
        <ul>
          <li>Stripe customer and subscription identifiers</li>
          <li>The card's brand and last four digits</li>
          <li>
            A <strong>card fingerprint</strong> from Stripe — an opaque identifier
            that does not reveal the card number
          </li>
        </ul>
        <p>
          The fingerprint enforces one free trial per card.{' '}
          <strong>It is deliberately kept after you delete your account</strong>, on
          the basis of our legitimate interest in preventing repeated trial abuse —
          if it were erased with the account, deleting an account would reset the
          limit and the control would be meaningless. It cannot be used to
          identify you or to charge you.
        </p>
      </LegalSection>

      <LegalSection heading="Who else can see your content">
        <ul>
          <li>
            <strong>Other members of a campaign you join.</strong> DM-only material
            (DM notes, session logs, NPC rosters, encounters, quests) is not
            visible to players. A player's journal is private to that player.
          </li>
          <li>
            <strong>Nobody outside the campaign.</strong> Access is enforced in the
            database by row-level security, not only in the interface.
          </li>
          <li>
            <strong>Our service providers</strong>, listed below.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Service providers">
        <ul>
          <li>
            <strong>Railway</strong> — hosting, databases and file storage. All app
            data lives here.
          </li>
          <li>
            <strong>Stripe</strong> — payment processing. Receives your payment
            details directly and tells us the outcome.
          </li>
          <li>
            <strong>Resend</strong> — sends transactional email such as sign-up
            confirmation and password resets. Receives your email address.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="How long we keep things">
        <ul>
          <li>
            <strong>While your account exists</strong> — until you delete the
            content, or the account.
          </li>
          <li>
            <strong>Lapsed campaigns</strong> — a campaign with no active
            subscription becomes read-only and is permanently deleted after three
            months, with warnings beforehand. See Refunds &amp; Cancellation.
          </li>
          <li>
            <strong>Backups</strong> — we keep 14 daily backups of the whole
            database. Deleted data therefore persists in backups for{' '}
            <strong>up to 14 days</strong> before ageing out. If we ever restore a
            backup, deletion requests made after it was taken are re-applied
            automatically.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Deleting your account">
        <p>
          You can delete your account at any time from your profile page. It is
          immediate and cannot be undone. Before you confirm, the app shows you
          exactly what will be removed.
        </p>
        <ul>
          <li>
            <strong>Campaigns you run are deleted for everyone in them</strong>,
            with all their content. There is no way to transfer a campaign to
            another DM, so please export first if others rely on it.
          </li>
          <li>
            Campaigns you only play in are unaffected; your character and journal
            are removed from them.
          </li>
          <li>Images you uploaded are deleted from storage.</li>
          <li>Active subscriptions are cancelled before anything is deleted.</li>
        </ul>
        <p>
          <strong>Two things deliberately survive deletion.</strong> We keep the
          card fingerprint described above, and a{' '}
          <strong>one-way hash of your email address</strong>, so that restoring a
          backup cannot silently bring your account back. The hash is not readable
          as an address, but we treat it as personal data and disclose it here
          rather than describing it as anonymous.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          Depending on where you live you may have rights to access, correct,
          export or delete your data, and to object to some processing.
          TableTopChaos supports these directly:
        </p>
        <ul>
          <li>
            <strong>Access and portability</strong> — export any campaign, or your
            journals, as a file, at any time.
          </li>
          <li>
            <strong>Correction</strong> — edit your profile and content in the app.
          </li>
          <li>
            <strong>Deletion</strong> — delete your account as described above.
          </li>
        </ul>
        <p>
          For anything the app cannot do for you, contact us using the address
          below. If you are in the UK or EEA you also have the right to complain
          to your data protection authority.
        </p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>
          TableTopChaos is not intended for children under 13, and under 16 where
          local law sets a higher age for consenting to online services without a
          parent. If we learn we are holding a younger child's data without proper
          consent, we will delete it.
        </p>
      </LegalSection>

      <LegalSection heading="Security, honestly stated">
        <p>
          Access rules are enforced in the database itself rather than only in the
          interface, passwords are stored hashed, images are stripped of embedded
          metadata, and card details never reach our servers.
        </p>
        <p>
          No service can promise perfect security, and we are not going to. If
          there is a breach affecting your data we will tell you, and any
          regulator we are required to notify.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          If we make a material change we will bring it to your attention in the
          app and ask you to accept the updated policy. The version and date of
          the policy you accepted is recorded on your account and shown on your
          profile page.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
