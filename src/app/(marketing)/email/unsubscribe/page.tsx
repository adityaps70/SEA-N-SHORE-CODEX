import type { Metadata } from 'next'
import Link from '@/components/navigation/intent-link'
import { MailX, TriangleAlert } from 'lucide-react'
import { createRankingEmailPreferences } from '@/features/ranking/ranking-email-sending'
import { RankingUnsubscribeButton } from './unsubscribe-button'
import { buttonClass } from '@/components/ui/interactive-styles'

export const metadata: Metadata = { title: 'Turn off emails', robots: { index: false } }
export const dynamic = 'force-dynamic'

const COPY = {
  job_alerts: {
    eyebrow: 'Job alert emails',
    title: 'Turn off job alert emails?',
    body: 'You will stop getting emails when new jobs match your alerts. Matches still appear under Notifications › Jobs on Sea N Shore, and you can turn the emails back on in Settings.',
  },
  weekly_digest: {
    eyebrow: 'Weekly digest',
    title: 'Turn off the weekly digest?',
    body: 'You will stop getting the weekly summary email. Everything in it is still on Sea N Shore, and you can turn the digest back on in Settings.',
  },
} as const

/**
 * Landing page for the unsubscribe link in job alert and digest emails (algorithms round G).
 * Nothing changes on page load; the person confirms with one button. No sign-in, no name or email.
 */
export default async function RankingUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: raw } = await searchParams
  const token = typeof raw === 'string' ? raw : null
  let topic: keyof typeof COPY | null = null
  if (token) {
    try {
      topic = await createRankingEmailPreferences().topicForToken(token)
    } catch {
      topic = null
    }
  }
  const copy = topic ? COPY[topic] : null

  return (
    <main id="main-content" className="mx-auto grid w-full max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-ocean-50 text-ocean-700">
          <MailX aria-hidden="true" className="size-5" />
        </span>
        {copy && token && topic ? (
          <>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">{copy.eyebrow}</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950">{copy.title}</h1>
            <p className="mt-3 text-sm leading-6 text-muted">{copy.body}</p>
            <div className="mt-6"><RankingUnsubscribeButton token={token} topic={topic} /></div>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-navy-950">We could not use this link</h1>
            <p role="alert" className="mt-3 flex items-start gap-2 text-sm leading-6 text-muted">
              <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-red-700" />
              <span>This unsubscribe link is incomplete or no longer valid. Sign in and choose your emails in Settings instead.</span>
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/settings/notifications" className={buttonClass()}>Email settings</Link>
              <Link href="/help" className={buttonClass('secondary')}>Contact & support</Link>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
