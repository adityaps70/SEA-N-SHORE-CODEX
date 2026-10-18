import type { Metadata } from 'next'
import Link from '@/components/navigation/intent-link'
import { MailX, TriangleAlert } from 'lucide-react'
import { NOTIFICATION_EMAIL_COPY } from '@/features/notification-emails/kinds'
import { inspectNotificationEmailToken } from '@/features/notification-emails/preferences'
import { NotificationUnsubscribeButton } from './unsubscribe-button'

export const metadata: Metadata = { title: 'Turn off emails', robots: { index: false } }
export const dynamic = 'force-dynamic'

/**
 * Landing page for the unsubscribe link in member activity emails (round H, H3). Nothing changes on page load; the
 * person confirms with one button. No sign-in, and no name or email address on the page.
 */
export default async function NotificationUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: raw } = await searchParams
  const token = typeof raw === 'string' ? raw : null
  const verified = token ? inspectNotificationEmailToken(token) : null
  const kind = verified?.ok ? verified.kind : null
  const copy = kind ? NOTIFICATION_EMAIL_COPY[kind] : null

  return (
    <main id="main-content" className="mx-auto grid w-full max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-ocean-50 text-ocean-700">
          <MailX aria-hidden="true" className="size-5" />
        </span>
        {copy && token && kind ? (
          <>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">{copy.title}</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950">Turn off {copy.turnOff}?</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              You will stop getting {copy.turnOff}. Your other emails stay as they are, everything still appears on Sea N Shore, and you can turn these back on in Settings.
            </p>
            <div className="mt-6"><NotificationUnsubscribeButton token={token} label={copy.turnOff} /></div>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-navy-950">We could not use this link</h1>
            <p role="alert" className="mt-3 flex items-start gap-2 text-sm leading-6 text-muted">
              <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-red-700" />
              <span>This unsubscribe link is incomplete or no longer valid. Sign in and choose your emails in Settings instead.</span>
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/settings/notifications" className="inline-flex min-h-11 items-center rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700">Email settings</Link>
              <Link href="/help" className="inline-flex min-h-11 items-center rounded-xl border border-mist-200 px-5 text-sm font-semibold text-navy-950 hover:bg-mist-50">Contact & support</Link>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
