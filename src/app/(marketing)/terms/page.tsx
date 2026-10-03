import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalList, LegalPage, LegalSection, RelatedPolicies, TextLink } from '@/components/legal/legal-page'
import { BUSINESS, businessAddressLine } from '@/config/business'

export const metadata: Metadata = { title: 'Terms' }

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="Responsible use of Sea N Shore"
      updated="28 September 2026"
      sections={[
        { href: '#responsible-use', label: 'Lawful use' },
        { href: '#user-content', label: 'Your content' },
        { href: '#platform-ip', label: 'Our materials' },
        { href: '#copyright-complaints', label: 'Copyright' },
        { href: '#payments', label: 'Payments & plans' },
        { href: '#contact', label: 'Contact' },
      ]}
      intro={
        <p>
          {BUSINESS.brandName} ({BUSINESS.brandTagline}) is operated by <strong className="text-navy-950">{BUSINESS.legalName}</strong>, {businessAddressLine()}. In these terms, &quot;{BUSINESS.brandName}&quot;, &quot;we&quot; and &quot;us&quot; mean {BUSINESS.legalName}.
        </p>
      }
    >
      <section aria-labelledby="responsible-use">
        <h2 id="responsible-use" className="text-lg font-bold text-navy-950">Professional and lawful use</h2>
        <div className="mt-2 space-y-3">
          <p>Members are responsible for the accuracy of information they submit and for using jobs, learning, messaging and community features professionally and lawfully.</p>
          <p>Do not impersonate another person or organisation, post fraudulent vacancies, misuse another member&apos;s information, or use the platform to distribute harmful, deceptive, infringing or unlawful content.</p>
          <p>Professional verification and trust signals improve context but do not replace a member&apos;s own due diligence before entering employment, commercial or training arrangements.</p>
        </div>
      </section>

      <section aria-labelledby="user-content">
        <h2 id="user-content" className="text-lg font-bold text-navy-950">User content and intellectual property</h2>
        <div className="mt-2 space-y-3">
          <p><strong className="text-navy-950">You retain ownership</strong> of the original content and intellectual-property rights you hold in material you post, upload or otherwise provide to Sea N Shore.</p>
          <p>When you submit user-generated content, you grant Sea N Shore a non-exclusive, worldwide, royalty-free licence to host, store, reproduce, process, technically format, display and distribute that content as reasonably necessary to operate, secure and provide the platform, including making it available to the audience you choose. This licence does not transfer ownership of your content to Sea N Shore.</p>
          <p>The licence continues for as long as the content remains on the service and may continue only to the extent reasonably necessary for backups, legal compliance, dispute handling, safety records or content that other members have independently shared or incorporated into permitted platform activity.</p>
          <p>You must have the rights and permissions needed for anything you upload. Do not post copyrighted images, videos, documents, articles, logos, course materials or other protected works unless you own them, have permission, or another lawful basis allows the use.</p>
        </div>
      </section>

      <section aria-labelledby="platform-ip">
        <h2 id="platform-ip" className="text-lg font-bold text-navy-950">Sea N Shore materials</h2>
        <p className="mt-2">The Sea N Shore name, branding, interface, software, original platform content and other materials supplied by Sea N Shore or its licensors remain protected by applicable intellectual-property laws. These terms do not grant members ownership of those materials.</p>
      </section>

      <section aria-labelledby="copyright-complaints">
        <h2 id="copyright-complaints" className="text-lg font-bold text-navy-950">Copyright complaints and review</h2>
        <div className="mt-2 space-y-3">
          <p>If you believe content on Sea N Shore infringes your copyright or other intellectual-property rights, use the content&apos;s <strong className="text-navy-950">Report</strong> control and choose <strong className="text-navy-950">Copyright or intellectual property infringement</strong>. Provide enough information to identify the original work, the material complained of, and your ownership or authority to act.</p>
          <p>Copyright complaints enter the platform moderation queue for review. Sea N Shore may request additional information, restrict or remove content while a complaint is assessed, preserve relevant records, restore content where appropriate, and take action against repeated or abusive misuse of the platform.</p>
          <p>
            See the <Link href="/copyright" className="font-semibold text-ocean-700 hover:underline">Copyright &amp; IP Policy</Link> for the reporting workflow and information to include in a complaint.
          </p>
        </div>
      </section>

      <LegalSection id="payments" title="Payments, plans and paid content">
        <LegalList>
          <li>Payments on {BUSINESS.brandName} are processed by our payment gateway, Cashfree Payments.</li>
          <li>Prices are in Indian rupees (INR) and include applicable taxes where this is stated at checkout. You see the exact amount before you pay.</li>
          <li>
            Creator Pro and Organization Pro renew automatically at the end of each monthly or yearly period, at the price shown when you subscribed, until you cancel auto-renew in Settings → Membership &amp; billing (or the organization&apos;s Plan &amp; billing). After you cancel, access continues until the end of the period already paid for.
          </li>
          <li>
            For paid events and courses, {BUSINESS.brandName} acts as a marketplace: we collect the payment on behalf of the event organiser or trainer and pay them their share, minus a platform fee.
          </li>
          <li>
            Refunds and cancellations follow the <TextLink href="/refunds">Refund &amp; cancellation policy</TextLink>. How and when you get access after paying is explained in the <TextLink href="/shipping">Shipping &amp; delivery policy</TextLink>.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about these terms? <TextLink href="/contact">Contact us</TextLink> at <TextLink href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</TextLink>.
        </p>
      </LegalSection>

      <RelatedPolicies
        links={[
          { href: '/privacy', label: 'Privacy Policy' },
          { href: '/refunds', label: 'Refunds & cancellation' },
          { href: '/shipping', label: 'Shipping & delivery' },
          { href: '/pricing', label: 'Pricing' },
          { href: '/contact', label: 'Contact us' },
        ]}
      />
    </LegalPage>
  )
}
