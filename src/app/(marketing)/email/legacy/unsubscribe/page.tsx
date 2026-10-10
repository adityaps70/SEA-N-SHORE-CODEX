import type { Metadata } from 'next'
import Link from 'next/link'
import { MailX, TriangleAlert } from 'lucide-react'
import { legacyReminderRepository } from '@/features/legacy-invites/reminder-repository'
import { LegacyUnsubscribeButton } from './unsubscribe-button'

export const metadata: Metadata = { title: 'Unsubscribe from Sea N Shore emails', robots: { index: false } }
export const dynamic = 'force-dynamic'

/**
 * Landing page for the unsubscribe link in the legacy account reminder. Nothing changes on page load (mail scanners
 * open links automatically); the person confirms with one button. No sign-in is needed and no name or email is shown.
 */
export default async function LegacyUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: raw } = await searchParams
  const token = typeof raw === 'string' ? raw : null
  let valid = false
  if (token) {
    try {
      valid = await legacyReminderRepository.isUnsubscribeToken(token)
    } catch {
      valid = false
    }
  }

  return (
    <main id="main-content" className="mx-auto grid w-full max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-ocean-50 text-ocean-700">
          <MailX aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Sea N Shore emails</p>
        {valid && token ? (
          <>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950">Stop emails from Sea N Shore?</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              We will not email this address again, about your old seaandshore.in account or anything else. You can still sign in to Sea N Shore at any time.
            </p>
            <div className="mt-6"><LegacyUnsubscribeButton token={token} /></div>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950">We could not use this link</h1>
            <p role="alert" className="mt-3 flex items-start gap-2 text-sm leading-6 text-muted">
              <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-red-700" />
              <span>This unsubscribe link is incomplete or no longer valid. Contact us and we will stop emails to your address.</span>
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/help" className="inline-flex min-h-11 items-center rounded-xl border border-mist-200 px-5 text-sm font-semibold text-navy-950 hover:bg-mist-50">
                Contact & support
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
