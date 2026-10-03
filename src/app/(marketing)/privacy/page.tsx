import type { Metadata } from 'next'
import { LegalList, LegalPage, LegalSection, RelatedPolicies, TextLink } from '@/components/legal/legal-page'
import { BUSINESS, businessAddressLine, grievanceContact } from '@/config/business'

export const metadata: Metadata = { title: 'Privacy' }

export default function PrivacyPage() {
  const grievance = grievanceContact()

  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy on Sea N Shore"
      updated="28 September 2026"
      sections={[
        { href: '#how-we-use', label: 'How we use it' },
        { href: '#payments', label: 'Payments' },
        { href: '#your-rights', label: 'Your requests' },
      ]}
      intro={
        <p>
          {BUSINESS.brandName} is operated by <strong className="text-navy-950">{BUSINESS.legalName}</strong>, {businessAddressLine()}, which is responsible for the personal information described here.
        </p>
      }
    >
      <LegalSection id="how-we-use" title="How we use your information">
        <p>Sea N Shore uses account and professional-profile information to provide member identity, discovery, jobs, learning, messaging and community features. Visibility controls should be respected wherever the product offers them.</p>
        <p>Private media and account-only data are not intended to be exposed through public storage addresses. Access should be delivered through authenticated or first-party application flows.</p>
        <p>Members should only publish information they are comfortable sharing with the audience selected for that feature and should keep sensitive personal or credential information out of public posts.</p>
      </LegalSection>

      <LegalSection id="payments" title="Payments">
        <p>
          Payments are processed by our payment gateway, Cashfree Payments. The card, UPI or bank details you enter at checkout go to Cashfree; {BUSINESS.brandName} keeps the order ID, amount, status and date so we can show receipts, give access and handle refunds.
        </p>
      </LegalSection>

      <LegalSection id="your-rights" title="Your data requests and grievances">
        <LegalList>
          <li>
            Signed-in members can download a copy of their data or permanently delete their account in <TextLink href="/settings#your-data">Settings → Your data &amp; privacy</TextLink>.
          </li>
          <li>
            For any other request about your personal data, or a complaint, write to{' '}
            {grievance.name ? <>{grievance.name}, Grievance Officer, at </> : null}
            <TextLink href={`mailto:${grievance.email}`}>{grievance.email}</TextLink>
            {grievance.phone ? <> or call {grievance.phone}</> : null} with the subject &quot;Grievance&quot;. We reply {BUSINESS.responseTime}.
          </li>
        </LegalList>
      </LegalSection>

      <RelatedPolicies
        links={[
          { href: '/contact', label: 'Contact us' },
          { href: '/terms', label: 'Terms' },
          { href: '/refunds', label: 'Refunds & cancellation' },
          { href: '/shipping', label: 'Shipping & delivery' },
        ]}
      />
    </LegalPage>
  )
}
