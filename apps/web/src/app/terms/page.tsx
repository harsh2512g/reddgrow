import type { Metadata } from 'next';
import Link from 'next/link';
import { PolicyPage } from '@/components/policy-page';

export const metadata: Metadata = { title: 'Terms of use' };
export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms of use"
      description="Conditions for exploring the local ThreadSignal development preview. Public service terms have not yet been finalized."
    >
      <section>
        <h2>Development availability</h2>
        <p>
          This preview offers local accounts, organization settings, team access, and plan records.
          Other product workflows remain in development. Availability and stored test data may
          change during development.
        </p>
      </section>
      <section>
        <h2>Responsible participation</h2>
        <p>
          You are responsible for following community rules and disclosing your real affiliation
          with products you recommend. ThreadSignal must never automatically submit comments, vote,
          send direct messages, create Reddit accounts, or conceal coordinated account control. Read
          the{' '}
          <Link href="/security" className="font-medium text-primary underline underline-offset-4">
            responsible-use commitments
          </Link>
          .
        </p>
      </section>
      <section>
        <h2>Accounts and authorization</h2>
        <p>
          Use an email address you control. Invite only authorized teammates, assign appropriate
          roles, and keep invitation links private. Do not attempt to access another organization’s
          information or bypass permissions and plan limits.
        </p>
      </section>
      <section>
        <h2>Plans and payments</h2>
        <p>
          Plan comparisons describe the intended product allowances. Billing is mocked in this
          preview, no payment is collected, and paid checkout is unavailable. A local trial record
          does not authorize any real charge.
        </p>
      </section>
      <section>
        <h2>No outcome guarantees</h2>
        <p>
          ThreadSignal does not guarantee moderator acceptance, Reddit account safety, rankings, AI
          citations, leads, revenue, or other outcomes. It is independent and is not affiliated with
          Reddit.
        </p>
      </section>
      <section>
        <h2>Before public availability</h2>
        <p>
          The owner must finalize the service provider identity, contact and support details,
          governing law, payment and cancellation terms, intellectual property provisions, and
          appropriate warranty and liability terms before offering a public service.
        </p>
      </section>
    </PolicyPage>
  );
}
