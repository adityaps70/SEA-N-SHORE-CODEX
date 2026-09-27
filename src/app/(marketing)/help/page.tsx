import type { Metadata } from 'next'
import Link from 'next/link'
import { SUPPORT_EMAIL } from '@/components/navigation/social-links'

export const metadata: Metadata = { title: 'Help' }

const topics = [
  { title: 'Your profile', body: 'Edit your Maritime Passport, experience and credentials.', href: '/profile', cta: 'Review profile' },
  { title: 'Jobs and applications', body: 'Browse vacancies and follow the status of your applications.', href: '/jobs', cta: 'Browse jobs' },
  { title: 'Learning', body: 'Continue enrolled courses and find new ones.', href: '/learn', cta: 'Open learning' },
  { title: 'Your data & privacy', body: 'Download a copy of your data or permanently delete your account.', href: '/settings#your-data', cta: 'Open data controls' },
  { title: 'Newsletter', body: 'Subscribe, change topics or unsubscribe.', href: '/newsletter', cta: 'Manage newsletter' },
  { title: 'Report content', body: 'Use the Report option on any post, job, event or profile. Copyright complaints follow the Copyright & IP policy.', href: '/copyright', cta: 'Copyright & IP policy' },
]

export default function HelpPage() {
  const supportEmail = SUPPORT_EMAIL.trim()

  return (
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
            Email <a href={`mailto:${supportEmail}`} className="font-semibold text-ocean-700 hover:underline">{supportEmail}</a>. Include the page, what you were trying to do and any message you saw, so we can help faster.
          </p>
        ) : (
          <p className="mt-2 text-sm leading-6 text-muted">
            A dedicated support inbox is being set up and will be listed here. Until then, use the Report option on the affected content for safety or content issues, and check the topics above for account tasks.
          </p>
        )}
      </div>
    </section>
  )
}
