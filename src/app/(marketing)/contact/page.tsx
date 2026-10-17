import type { Metadata } from 'next'
import { BusinessContactDetails } from '@/components/legal/business-contact-details'
import { LegalList, LegalPage, LegalSection, RelatedPolicies, TextLink } from '@/components/legal/legal-page'
import { BUSINESS, grievanceContact } from '@/config/business'
import { getGrievanceOfficer } from '@/features/site-settings/queries'
import { hasGrievanceOfficer } from '@/features/site-settings/schemas'
import { ContactForm } from '@/features/support/components/contact-form'
import { getSupportViewer } from '@/features/support/viewer'
import { metaDescription } from '@/lib/seo/meta'

// Round H (H5): a canonical address and a plain-text search description.
export const metadata: Metadata = {
  title: 'Contact us',
  description: metaDescription(`Contact ${BUSINESS.brandName}, operated by ${BUSINESS.legalName}, ${BUSINESS.city}.`),
  alternates: { canonical: '/contact' },
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * Round H (H7): the Contact page form (a ticket for the admins, emailed to operations by the outbox
 * worker), the full registered address (the one printed on GST invoices) and the Grievance Officer
 * from Admin › Site settings. Until an officer is named, the section says one is being appointed and
 * gives the support email, so a grievance route is always published.
 */
export default async function ContactPage({ searchParams }: { searchParams: SearchParams }) {
  const [viewer, officer, params] = await Promise.all([getSupportViewer(), getGrievanceOfficer(), searchParams])
  const fallback = grievanceContact()
  const named = hasGrievanceOfficer(officer)
  const grievanceEmail = named ? officer.email : fallback.email
  const topic = typeof params.topic === 'string' ? params.topic : ''

  return (
    <LegalPage
      eyebrow="Contact us"
      title="Contact us"
      sections={[
        { href: '#contact-form', label: 'Send a message' },
        { href: '#grievance-officer', label: 'Grievance Officer' },
        { href: '#self-service', label: 'Self-service help' },
      ]}
      intro={
        <p>
          {BUSINESS.brandName} ({BUSINESS.brandTagline}) is operated by <strong className="text-navy-950">{BUSINESS.legalName}</strong>, {BUSINESS.city}, {BUSINESS.region}, {BUSINESS.country}. Write or call us about your account, payments, refunds, events, courses or anything else on the platform.
        </p>
      }
    >
      <BusinessContactDetails />

      <section id="contact-form" aria-label="Contact form" className="scroll-mt-24 rounded-2xl border border-mist-100 bg-white p-5 max-md:p-4">
        <ContactForm
          defaultName={viewer?.name ?? ''}
          defaultEmail={viewer?.email ?? ''}
          signedIn={Boolean(viewer)}
          initialTopic={topic}
        />
      </section>

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

      <LegalSection id="grievance-officer" title="Grievance Officer">
        {named ? (
          <dl className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
            <dt className="font-semibold text-navy-950">Name</dt>
            <dd className="min-w-0">{officer.name}</dd>
            <dt className="font-semibold text-navy-950">Email</dt>
            <dd className="min-w-0 break-words"><TextLink href={`mailto:${officer.email}`}>{officer.email}</TextLink></dd>
            {officer.responseTime ? (
              <>
                <dt className="font-semibold text-navy-950">Response time</dt>
                <dd className="min-w-0">{officer.responseTime}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p>
            A Grievance Officer is being appointed and will be named here. Until then, send a grievance to{' '}
            <TextLink href={`mailto:${fallback.email}`}>{fallback.email}</TextLink> with the subject &quot;Grievance&quot;, or choose &quot;A complaint (grievance)&quot; in the form above.
          </p>
        )}
      </LegalSection>

      <LegalSection id="grievances" title="Grievances and data requests">
        <p>
          For a complaint about the platform, or a request about your personal data, write to{' '}
          {named ? <>{officer.name}, Grievance Officer, at </> : null}
          <TextLink href={`mailto:${grievanceEmail}`}>{grievanceEmail}</TextLink>
          {!named && fallback.phone ? <> or call {fallback.phone}</> : null} with the subject &quot;Grievance&quot;. The{' '}
          <TextLink href="/privacy#your-rights">Privacy Policy</TextLink> explains what you can ask for and how you can download or delete your data yourself.
        </p>
      </LegalSection>

      <LegalSection id="self-service" title="Help you can get straight away">
        <LegalList>
          <li><TextLink href="/help">Help</TextLink> — account, profile, jobs, learning and newsletter topics.</li>
          {viewer ? <li><TextLink href="/help/requests">My requests</TextLink> — the messages you sent us and our answers.</li> : null}
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
