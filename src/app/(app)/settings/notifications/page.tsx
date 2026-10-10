import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { backLinkClass } from '@/components/ui/interactive-styles'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { createLearningEmailPreferences } from '@/features/learning/learning-email-sending'
import { LearningEmailToggle } from './learning-email-toggle'
import { memberTimeZoneRepository } from '@/features/learning/sessions/member-time-zone'
import { TimeZoneSetting } from '@/features/learning/sessions/components/time-zone-setting'

export const metadata: Metadata = { title: 'Email notifications · Settings' }
export const dynamic = 'force-dynamic'

const preferences = createLearningEmailPreferences()

/** Settings → Email notifications (learning round A): which notifications also come by email. */
export default async function EmailNotificationsPage() {
  const user = await requireAwsUser()
  const [learningEnabled, timeZone] = await Promise.all([
    preferences.learningEmailsEnabled(user.id),
    memberTimeZoneRepository.get(user.id).catch(() => ({ timeZone: null, source: 'auto' as const })),
  ])

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 py-2 max-md:space-y-3 max-md:py-0 sm:py-5">
      <MobilePageBar backHref="/settings" title="Email notifications" />
      <header className="max-md:hidden">
        <Link href="/settings" className={backLinkClass}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Settings
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Email notifications</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Choose which updates also come to your email. Everything still appears in Notifications on Sea N Shore.
        </p>
      </header>
      <p className="text-sm leading-6 text-muted md:hidden">Everything still appears in Notifications on Sea N Shore.</p>
      <section aria-label="Learning" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:px-4 max-md:shadow-none">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">Learning</h2>
        <div className="mt-2">
          <LearningEmailToggle initiallyEnabled={learningEnabled} />
        </div>
        <div className="mt-5 border-t border-mist-100 pt-5">
          <TimeZoneSetting initialSource={timeZone.source} initialZone={timeZone.timeZone} />
        </div>
      </section>
      <p className="text-sm leading-6 text-muted max-md:px-0">
        The newsletter has its own settings: <Link href="/newsletter" className="font-semibold text-ocean-700 hover:underline">Newsletter</Link>.
      </p>
    </main>
  )
}
