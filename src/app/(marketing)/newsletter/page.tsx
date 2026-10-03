import type { Metadata } from 'next'
import Link from 'next/link'
import { Inbox, LockKeyhole, MailCheck } from 'lucide-react'
import { NewsletterPreferencesForm } from '@/features/newsletter/components/newsletter-preferences-form'
import { NewsletterSignupForm } from '@/features/newsletter/components/newsletter-signup-form'
import { getViewerNewsletterState } from '@/features/newsletter/queries'

export const metadata: Metadata = {
  title: 'Newsletter',
  description: 'Subscribe to the Sea N Shore newsletter for maritime news, jobs, learning and events.',
}

export const dynamic = 'force-dynamic'

const promises = [
  {
    icon: MailCheck,
    title: 'Only what you choose',
    body: 'Pick one or more topics. We only send the ones you tick, and you can change them at any time.',
  },
  {
    icon: LockKeyhole,
    title: 'Your address stays with us',
    body: 'Your email and consent record are stored by Sea N Shore and delivered through Amazon SES. We do not sell or share your address.',
  },
  {
    icon: Inbox,
    title: 'Leave in one click',
    body: 'Every email has an unsubscribe link that works without signing in. Most mail apps also show an Unsubscribe button.',
  },
]

export default async function NewsletterPage() {
  const { viewer, subscriber, loadFailed } = await getViewerNewsletterState()
  const viewerSubscribed = subscriber?.status === 'subscribed'
  const viewerPending = subscriber?.status === 'pending'

  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
        <section>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Newsletter</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-950 sm:text-4xl">Maritime news and opportunities, in your inbox.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
            The Sea N Shore newsletter brings product news, a digest of new sea and shore vacancies, and upcoming courses and events to people who ask for it.
          </p>
          <ul className="mt-6 grid gap-3">
            {promises.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3 rounded-2xl border border-mist-100 bg-white p-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span>
                  <span className="block font-semibold text-navy-950">{title}</span>
                  <span className="mt-0.5 block text-sm leading-6 text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-muted">
            Read the <Link href="/privacy" className="font-semibold text-ocean-700 hover:underline">Privacy Policy</Link> for how Sea N Shore handles personal data.
          </p>
        </section>

        <section aria-label={viewerSubscribed ? 'Manage your newsletter subscription' : 'Subscribe'} className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          {loadFailed ? (
            <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
              We could not check your current subscription just now. You can still subscribe below; if you are already subscribed nothing will change.
            </p>
          ) : null}
          {viewerSubscribed && subscriber ? (
            <>
              <h2 className="text-lg font-semibold text-navy-950">Your newsletter</h2>
              <div className="mt-3">
                <NewsletterPreferencesForm email={subscriber.email} topics={subscriber.topics} />
              </div>
            </>
          ) : (
            <>
              {viewerPending ? (
                <p className="mb-4 rounded-xl border border-mist-200 bg-mist-50 px-3.5 py-2.5 text-sm leading-6 text-navy-950">
                  Your address is waiting for confirmation. Subscribe again below with your account email to confirm straight away.
                </p>
              ) : null}
              <NewsletterSignupForm defaultEmail={viewer?.verifiedEmail ?? null} source="newsletter_page" />
            </>
          )}
        </section>
      </div>
    </main>
  )
}
