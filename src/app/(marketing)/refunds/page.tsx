import type { Metadata } from 'next'
import { LegalList, LegalPage, LegalSection, RelatedPolicies, TextLink } from '@/components/legal/legal-page'
import { BUSINESS } from '@/config/business'

export const metadata: Metadata = {
  title: 'Refund & cancellation policy',
  description: `How refunds and cancellations work for event tickets, courses and plans on ${BUSINESS.brandName}.`,
}

export default function RefundsPage() {
  const mail = `mailto:${BUSINESS.email}`

  return (
    <LegalPage
      eyebrow="Refunds & cancellation"
      title="Refund & cancellation policy"
      updated="28 September 2026"
      sections={[
        { href: '#event-tickets', label: 'Event tickets' },
        { href: '#courses', label: 'Courses' },
        { href: '#plans', label: 'Plans' },
        { href: '#how-to-request', label: 'How to ask' },
        { href: '#sellers', label: 'For sellers' },
        { href: '#questions', label: 'Questions' },
      ]}
      intro={
        <p>
          This policy covers everything you can pay for on {BUSINESS.brandName}: paid event tickets, paid courses and the Creator Pro and Organization Pro plans. {BUSINESS.brandName} is operated by {BUSINESS.legalName}, {BUSINESS.city}, {BUSINESS.country}. All payments are in Indian rupees (INR) and are processed securely by our payment gateway, Cashfree Payments.
        </p>
      }
    >
      <LegalSection id="event-tickets" title="Paid event tickets">
        <LegalList>
          <li>
            <strong className="text-navy-950">Organiser cancels, or the event cannot take place:</strong> you get a full refund to the original payment method.
          </li>
          <li>
            <strong className="text-navy-950">You cancel:</strong> full refund if you ask at least 48 hours before the event starts. Requests made later, and no-shows, are not refundable unless the organiser agrees.
          </li>
          <li>
            <strong className="text-navy-950">Event rescheduled:</strong> your ticket stays valid for the new date, or you can ask for a full refund before the new date.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="courses" title="Paid courses">
        <p>
          You can get a refund if you ask within 7 days of purchase, you have completed less than 20% of the course and no certificate has been issued. Your access to the course ends when the refund is made.
        </p>
      </LegalSection>

      <LegalSection id="plans" title="Creator Pro and Organization Pro (auto-renewing plans)">
        <LegalList>
          <li>
            Plans renew automatically each month or year. You can cancel auto-renew at any time in <strong className="text-navy-950">Settings → Membership &amp; billing</strong>; for an organization, an owner or administrator does this in the organization&apos;s <strong className="text-navy-950">Plan &amp; billing</strong>.
          </li>
          <li>After you cancel, access continues until the end of the period you have already paid for. You are not charged again.</li>
          <li>We do not refund partly used periods.</li>
          <li>Charges made in error and duplicate charges are refunded in full.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="how-to-request" title="How to ask for a refund">
        <LegalList>
          <li>
            Email <TextLink href={mail}>{BUSINESS.email}</TextLink> with your <strong className="text-navy-950">order ID</strong>, the amount, the date you paid and the reason. You can also ask the event organiser or the course team directly; they can refund you from their dashboards.
          </li>
          <li>Approved refunds are processed within 5–7 working days to the original payment method. Your bank or card issuer may take a few more days to show the money in your account.</li>
          <li>
            If a payment failed, you have not been charged. If money left your account for a failed payment, your bank reverses it automatically. If you do not see it back, <TextLink href="/contact">contact us</TextLink> with the order ID.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="sellers" title="For event organisers and trainers">
        <p>
          {BUSINESS.brandName} collects payments for paid events and courses and pays organisers and trainers their share. When a buyer is refunded, the refunded amount is deducted from the organiser&apos;s or trainer&apos;s earnings. You can see refunds and your balance in <TextLink href="/settings/earnings">Earnings</TextLink>.
        </p>
      </LegalSection>

      <LegalSection id="questions" title="Questions">
        <p>
          <TextLink href="/contact">Contact us</TextLink> at <TextLink href={mail}>{BUSINESS.email}</TextLink> or {BUSINESS.phone.display} ({BUSINESS.supportHours}). We reply {BUSINESS.responseTime}.
        </p>
      </LegalSection>

      <RelatedPolicies
        links={[
          { href: '/pricing', label: 'Pricing' },
          { href: '/shipping', label: 'Shipping & delivery' },
          { href: '/terms', label: 'Terms' },
          { href: '/contact', label: 'Contact us' },
        ]}
      />
    </LegalPage>
  )
}
