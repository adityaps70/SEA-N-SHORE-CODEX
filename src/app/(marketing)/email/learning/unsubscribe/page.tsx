import { MainLandmark } from '@/components/layout/main-landmark'
import type { Metadata } from 'next'
import Link from '@/components/navigation/intent-link'
import { MailX, TriangleAlert } from 'lucide-react'
import { createLearningEmailPreferences } from '@/features/learning/learning-email-sending'
import { LearningUnsubscribeButton } from './unsubscribe-button'
import { buttonClass } from '@/components/ui/interactive-styles'

export const metadata: Metadata = { title: 'Turn off learning emails', robots: { index: false } }
export const dynamic = 'force-dynamic'

/**
 * Landing page for the unsubscribe link in learning emails (learning round A, A6). Nothing changes
 * on page load (mail scanners open links automatically); the person confirms with one button.
 * Signing in is not needed, and the page shows no name or email address.
 */
export default async function LearningUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: raw } = await searchParams
  const token = typeof raw === 'string' ? raw : null
  let valid = false
  if (token) {
    try {
      valid = await createLearningEmailPreferences().isUnsubscribeToken(token)
    } catch {
      valid = false
    }
  }

  return (
    <MainLandmark className="mx-auto grid w-full max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-ocean-50 text-ocean-700">
          <MailX aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Learning emails</p>
        {valid && token ? (
          <>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950">Turn off learning emails?</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              You will stop getting emails about enrolments, new course materials, grades, certificates, course reviews and submissions to grade. These updates still appear in Notifications on Sea N Shore, and you can turn the emails back on in Settings.
            </p>
            <div className="mt-6"><LearningUnsubscribeButton token={token} /></div>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950">We could not use this link</h1>
            <p role="alert" className="mt-3 flex items-start gap-2 text-sm leading-6 text-muted">
              <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-red-700" />
              <span>This unsubscribe link is incomplete or no longer valid. Sign in and choose your emails in Settings instead.</span>
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/settings/notifications" className={buttonClass()}>
                Email settings
              </Link>
              <Link href="/help" className={buttonClass('secondary')}>
                Contact & support
              </Link>
            </div>
          </>
        )}
      </section>
    </MainLandmark>
  )
}
