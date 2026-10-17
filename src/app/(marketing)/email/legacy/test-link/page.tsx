import { MainLandmark } from '@/components/layout/main-landmark'
import type { Metadata } from 'next'
import { FlaskConical } from 'lucide-react'

export const metadata: Metadata = { title: 'This is a test link', robots: { index: false } }

/**
 * Where the links in an admin's test reminder go ("Send test to me" in Admin → Legacy invites). It reads nothing and
 * changes nothing: a test never claims a profile or adds anyone to the do-not-email list.
 */
export default function LegacyTestLinkPage() {
  return (
    <MainLandmark className="mx-auto grid w-full max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-ocean-50 text-ocean-700">
          <FlaskConical aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Sea N Shore emails</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950">This is a test link</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          It came from a test email sent by a Sea N Shore admin. Nothing was claimed and nothing was changed: no profile, no email settings.
        </p>
      </section>
    </MainLandmark>
  )
}
