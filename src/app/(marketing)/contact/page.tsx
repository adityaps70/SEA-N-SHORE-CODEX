import type { Metadata } from 'next'
import { BusinessContactDetails } from '@/components/legal/business-contact-details'
import { LegalList, LegalPage, LegalSection, RelatedPolicies, TextLink } from '@/components/legal/legal-page'
import { BUSINESS, grievanceContact } from '@/config/business'

export const metadata: Metadata = {
  title: 'Contact us',
  description: `Contact ${BUSINESS.brandName}, operated by ${BUSINESS.legalName}, ${BUSINESS.city}.`,
}

export default function ContactPage() {
  const grievance = grievanceContact()

  return (
    <LegalPage
      eyebrow="Contact us"
      title="Contact us"
      intro={
        <p>
          {BUSINESS.brandName} ({BUSINESS.brandTagline}) is operated by <strong className="text-navy-950">{BUSINESS.legalName}</strong>, {BUSINESS.city}, {BUSINESS.region}, {BUSINESS.country}. Write or call us about your account, payments, refunds, events, courses or anything else on the platform.
        </p>
      }
    >
      <BusinessContactDetails />

      <LegalSection id="what-to-include" title="What to include">
        <LegalList>
          <li>The email address or phone number on your {BUSINESS.brandName} account.</li>
          <li>
            For a payment, refund or plan question: the <strong className="text-navy-950">order ID</strong> from your receipt or confirmation email, the amount and the date you paid.
          </li>
          <li>The page you were on, what you were trying to do and any message you saw.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="response-time" title="When we reply">
        <p>
          We reply {BUSINESS.responseTime} ({BUSINESS.supportHours}). Messages sent outside these hours are answered on the next working day.
        </p>
      </LegalSection>

      <LegalSection id="grievances" title="Grievances and data requests">
        <p>
          For a complaint about the platform, or a request about your personal data, write to{' '}
          {grievance.name ? <>{grievance.name}, Grievance Officer, at </> : null}
          <TextLink href={`mailto:${grievance.email}`}>{grievance.email}</TextLink>
          {grievance.phone ? <> or call {grievance.phone}</> : null} with the subject &quot;Grievance&quot;. The{' '}
          <TextLink href="/privacy#your-rights">Privacy Policy</TextLink> explains what you can ask for and how you can download or delete your data yourself.
        </p>
      </LegalSection>

      <LegalSection id="self-service" title="Help you can get straight away">
        <LegalList>
          <li><TextLink href="/help">Help</TextLink> — account, profile, jobs, learning and newsletter topics.</li>
          <li><TextLink href="/refunds">Refund &amp; cancellation policy</TextLink> — event tickets, courses and plans.</li>
          <li><TextLink href="/shipping">Shipping &amp; delivery policy</TextLink> — how and when you get access after paying.</li>
          <li>Safety or content problem? Use the <strong className="text-navy-950">Report</strong> option on the post, job, event or profile.</li>
        </LegalList>
      </LegalSection>

      <RelatedPolicies
        links={[
          { href: '/pricing', label: 'Pricing' },
          { href: '/refunds', label: 'Refunds & cancellation' },
          { href: '/shipping', label: 'Shipping & delivery' },
          { href: '/terms', label: 'Terms' },
          { href: '/privacy', label: 'Privacy Policy' },
        ]}
      />
    </LegalPage>
  )
}
