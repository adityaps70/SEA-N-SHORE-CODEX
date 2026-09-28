import type { Metadata } from 'next'
import Link from 'next/link'
import { SUPPORT_EMAIL } from '@/components/navigation/social-links'
import { BUSINESS, OPERATOR_LINE, telHref } from '@/config/business'

export const metadata: Metadata = { title: 'Help' }

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

export default function HelpPage() {
  const supportEmail = SUPPORT_EMAIL.trim()

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
