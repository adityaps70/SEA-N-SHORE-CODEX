import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { XCircle } from 'lucide-react'
import { getVerifiedUser } from '@/features/auth/queries'

/** Verification codes are UUIDs (learning_certificates.verification_code); anything else matches nothing. */
const VERIFICATION_CODE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isVerificationCode(value: string) {
  return VERIFICATION_CODE_PATTERN.test(value)
}

/** Round H (H5): the title of the "Certificate not verified" state, for an unknown code and for a malformed one (404). */
export const CERTIFICATE_NOT_FOUND_METADATA: Metadata = {
  title: { absolute: 'Certificate not found · Sea N Shore' },
  robots: { index: false },
}

/** Signed-out visitor? Fails open to "visitor" so the page still renders if auth is down. */
export async function isVisitor() {
  try {
    return !(await getVerifiedUser())
  } catch {
    return true
  }
}

/**
 * Phones, signed-out visitors only: a slim invitation to join, stuck to the bottom of the
 * screen. It is `sticky` (not fixed) right after <main>, so it stops above the site footer
 * instead of covering it.
 */
export function JoinBar() {
  return (
    <aside
      aria-label="Join Sea N Shore"
      className="sticky bottom-0 z-40 border-t border-mist-100 bg-white px-4 pb-[calc(0.625rem+env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-8px_24px_-12px_rgb(7_27_45/0.25)] md:hidden"
      data-certificate-join-bar=""
    >
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <p className="min-w-0 flex-1 text-sm leading-5 text-muted">
          <span className="block truncate font-semibold text-navy-950">Join Sea N Shore</span>
          <span className="block truncate">Courses with certificates you can show</span>
        </p>
        <Link
          href="/auth/sign-up"
          className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-ocean-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
        >
          Join now
        </Link>
      </div>
    </aside>
  )
}

/** The "Certificate not verified" state: an unknown code (200) or a malformed one (404, via not-found.tsx). */
export function CertificateNotVerified({ joinBar }: { joinBar: ReactNode }) {
  return (
    <>
      <main className="mx-auto flex min-h-[70vh] max-w-3xl items-center px-5 py-16">
        <section className="w-full rounded-[2rem] border border-rose-100 bg-white p-7 text-center shadow-[var(--shadow-card)] sm:p-10">
          <XCircle className="mx-auto size-10 text-rose-600" aria-hidden="true" />
          <h1 className="mt-4 text-3xl font-bold text-navy-950">Certificate not verified</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">
            No Sea N Shore Learning certificate matches this verification code. Check the code printed on the certificate and try again.
          </p>
        </section>
      </main>
      {joinBar}
    </>
  )
}
