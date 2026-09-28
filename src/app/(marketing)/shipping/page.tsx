import type { Metadata } from 'next'
import { LegalList, LegalPage, LegalSection, RelatedPolicies, TextLink } from '@/components/legal/legal-page'
import { BUSINESS } from '@/config/business'

export const metadata: Metadata = {
  title: 'Shipping & delivery policy',
  description: `${BUSINESS.brandName} sells digital services only. How and when you get access after paying.`,
}

export default function ShippingPage() {
  return (
    <LegalPage
      eyebrow="Shipping & delivery"
      title="Shipping & delivery policy"
      updated="28 September 2026"
      intro={
        <p>
          {BUSINESS.brandName}, operated by {BUSINESS.legalName}, {BUSINESS.city}, {BUSINESS.country}, sells <strong className="text-navy-950">digital services only</strong>: memberships (Creator Pro and Organization Pro), tickets for online and offline events, and online courses. Nothing physical is shipped, so there are no shipping charges.
        </p>
      }
    >
      <LegalSection id="delivery" title="How you get what you paid for">
        <p>
          Access is given online, in your {BUSINESS.brandName} account, as soon as the payment is confirmed — usually within minutes.
        </p>
        <LegalList>
          <li>
            <strong className="text-navy-950">Event tickets:</strong> your ticket and joining details appear in <TextLink href="/events/my">My events</TextLink>, and by email where applicable. For an offline event you attend at the venue shown on the event page.
          </li>
          <li>
            <strong className="text-navy-950">Courses:</strong> the course opens in <TextLink href="/learn/my-learning">My learning</TextLink>.
          </li>
          <li>
            <strong className="text-navy-950">Plans:</strong> Creator Pro activates on your account, and Organization Pro on the organization&apos;s account. You can see the plan in <TextLink href="/settings/billing">Membership &amp; billing</TextLink>.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="not-received" title="If your access does not appear">
        <p>
          If you paid and your ticket, course or plan does not appear within 24 hours, <TextLink href="/contact">contact us</TextLink> at <TextLink href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</TextLink> or {BUSINESS.phone.display} with your <strong className="text-navy-950">order ID</strong>. We reply {BUSINESS.responseTime}.
        </p>
      </LegalSection>

      <LegalSection id="cancellations" title="Cancellations and refunds">
        <p>
          See the <TextLink href="/refunds">Refund &amp; cancellation policy</TextLink> for when you can cancel and get your money back.
        </p>
      </LegalSection>

      <RelatedPolicies
        links={[
          { href: '/pricing', label: 'Pricing' },
          { href: '/refunds', label: 'Refunds & cancellation' },
          { href: '/terms', label: 'Terms' },
          { href: '/contact', label: 'Contact us' },
        ]}
      />
    </LegalPage>
  )
}
