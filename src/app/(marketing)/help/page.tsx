import type { Metadata } from 'next'
import Link from 'next/link'
import { FaqAccordion } from '@/components/marketing/faq/faq-accordion'
import { faqGroups, faqJsonLd, jsonLdScript } from '@/components/marketing/faq/faq-data'
import { SUPPORT_EMAIL } from '@/components/navigation/social-links'
import { BUSINESS, OPERATOR_LINE, telHref } from '@/config/business'
import { getCognitoEnvironment } from '@/lib/env'

export const metadata: Metadata = {
  title: 'Help',
  description: 'Help and frequently asked questions about Sea N Shore: membership, jobs, company pages, courses, events, payments and your account.',
}
// The FAQ mentions Google sign-in only when it is switched on at runtime.
export const dynamic = 'force-dynamic'

const topics = [
  { title: 'Your profile', body: 'Edit your Maritime Passport, experience and credentials.', href: '/profile', cta: 'Review profile' },
  { title: 'Jobs and applications', body: 'Browse vacancies and follow the status of your applications.', href: '/jobs', cta: 'Browse jobs' },
  { title: 'Learning', body: 'Continue enrolled courses and find new ones.', href: '/learn', cta: 'Open learning' },
  { title: 'Your data & privacy', body: 'Download a copy of your data or permanently delete your account.', href: '/settings#your-data', cta: 'Open data controls' },
  { title: 'Newsletter', body: 'Subscribe, change topics or unsubscribe.', href: '/newsletter', cta: 'Manage newsletter' },
  { title: 'Plans and prices', body: 'See what Member, Creator Pro and Organization Pro include and cost.', href: '/pricing', cta: 'See pricing' },
  { title: 'Refunds and cancellations', body: 'When event tickets, courses and plans can be cancelled or refunded, and how to ask.', href: '/refunds', cta: 'Read the refund policy' },
  { title: 'Getting access after paying', body: 'Everything is digital: when your ticket, course or plan appears after payment.', href: '/shipping', cta: 'Read the delivery policy' },
  { title: 'Report content', body: 'Use the Report option on any post, job, event or profile. Copyright complaints follow the Copyright & IP policy.', href: '/copyright', cta: 'Copyright & IP policy' },
]

/** Same rule as /auth/sign-in: Google sign-in is only mentioned when it is switched on. */
function isGoogleSignInEnabled() {
  try {
    return getCognitoEnvironment().AWS_COGNITO_GOOGLE_ENABLED
  } catch {
    return false
  }
}

export default function HelpPage() {
  const supportEmail = SUPPORT_EMAIL.trim()
  const groups = faqGroups({ googleEnabled: isGoogleSignInEnabled() })

  return (
    <main className="px-4 py-8 sm:px-6 sm:py-12">
      <section className="mx-auto grid max-w-3xl gap-5">
        <div className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Help</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-950">Get help with your Sea N Shore account and professional activity.</h1>
          <p className="mt-4 text-sm leading-7 text-muted">
            Start with the topic below that matches what you are trying to do. Most pages also explain what to do next beside the action itself, including when something could not be saved.
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {topics.map((topic) => (
            <li key={topic.title} className="rounded-2xl border border-mist-100 bg-white p-4">
              <p className="font-semibold text-navy-950">{topic.title}</p>
              <p className="mt-1 text-sm leading-6 text-muted">{topic.body}</p>
              <Link href={topic.href} className="mt-2 inline-flex min-h-9 items-center text-sm font-semibold text-ocean-700 hover:text-navy-950">
                {topic.cta} →
              </Link>
            </li>
          ))}
        </ul>

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24 rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(faqJsonLd(groups.flatMap((group) => group.items))) }} />
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">FAQ</p>
          <h2 id="faq-title" className="mt-2 text-2xl font-bold tracking-tight text-navy-950">Frequently asked questions</h2>
          <nav aria-label="FAQ topics" className="mt-4">
            <ul className="flex flex-wrap gap-2">
              {groups.map((group) => (
                <li key={group.id}>
                  <a href={`#faq-${group.id}`} className="inline-flex min-h-9 items-center rounded-full border border-mist-200 bg-mist-50 px-3 text-sm font-semibold text-navy-900 transition-colors hover:border-ocean-300 hover:bg-white">
                    {group.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-6 grid gap-8">
            {groups.map((group) => (
              <div key={group.id} id={`faq-${group.id}`} className="scroll-mt-24">
                <h3 className="text-lg font-semibold text-navy-950">{group.title}</h3>
                <div className="mt-3">
                  <FaqAccordion items={group.items} idPrefix={`faq-${group.id}`} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <div id="contact" className="scroll-mt-24 rounded-2xl border border-mist-100 bg-white p-5">
          <h2 className="text-lg font-semibold text-navy-950">Contact support</h2>
          {supportEmail ? (
            <p className="mt-2 text-sm leading-6 text-muted">
              Email <a href={`mailto:${supportEmail}`} className="font-semibold text-ocean-700 hover:underline">{supportEmail}</a>
              {BUSINESS.phone.display ? (
                <> or call <a href={telHref(BUSINESS.phone.tel)} className="font-semibold text-ocean-700 hover:underline">{BUSINESS.phone.display}</a></>
              ) : null}
              {BUSINESS.supportHours ? <> ({BUSINESS.supportHours})</> : null}. Include the page, what you were trying to do and any message you saw — and the order ID for a payment question — so we can help faster. We reply {BUSINESS.responseTime}.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted">
              A dedicated support inbox is being set up and will be listed here. Until then, use the Report option on the affected content for safety or content issues, and check the topics above for account tasks.
            </p>
          )}
          <Link href="/contact" className="mt-3 inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-900 transition-colors hover:border-ocean-300 hover:bg-mist-50">
            Contact us
          </Link>
          <p className="mt-4 text-xs text-muted">{OPERATOR_LINE}</p>
        </div>
      </section>
    </main>
  )
}
