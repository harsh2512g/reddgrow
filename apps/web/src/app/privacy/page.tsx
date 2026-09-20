import type { Metadata } from 'next';
import { PolicyPage } from '@/components/policy-page';

export const metadata: Metadata = { title: 'Privacy notice' };
export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy notice"
      description="An honest description of the data used by this development preview, and the questions that must be settled before launch."
    >
      <section>
        <h2>Information in the workspace</h2>
        <p>
          The application stores account email addresses, authenticated sessions, organization
          settings, team memberships, invitations, trial and plan records, and operational activity.
          Only use test or personal project data in this preview.
        </p>
      </section>
      <section>
        <h2>Purpose and access</h2>
        <p>
          Account and organization information supports sign-in, workspace administration,
          invitations, access controls, and plan allocation. Membership checks and database policies
          restrict organization access. Application logging must not expose session tokens or
          provider secrets.
        </p>
      </section>
      <section>
        <h2>Providers and cookies</h2>
        <p>
          Authentication and workspace data use the configured Supabase project (local or personal
          development), and authentication uses session cookies. Reddit, AI, and billing providers
          are mocked; application email uses console mode, and the crawler uses fixtures. No
          advertising or marketing analytics integration is active.
        </p>
      </section>
      <section>
        <h2>Retention and requests</h2>
        <p>
          Data remains in the configured development database until it is reset or removed.
          Organization owners can record export and deletion requests in settings. Those requests
          require follow-up and do not themselves perform a full export or deletion.
        </p>
      </section>
      <section>
        <h2>Before public availability</h2>
        <p>
          The project owner must publish the controller’s identity and contact details, legal bases,
          retention periods, subprocessors, international transfer details where applicable, and
          procedures for privacy requests. These details are not yet established for a public
          service.
        </p>
      </section>
    </PolicyPage>
  );
}
