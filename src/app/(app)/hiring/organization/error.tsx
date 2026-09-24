'use client'

import Link from 'next/link'

export default function OrganizationVerificationError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <section
        role="alert"
        className="rounded-[1.5rem] border border-red-200 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8"
      >
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">Organization verification needs attention</p>
        <h1 className="mt-2 text-2xl font-bold text-navy-950">We could not load organization verification.</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Nothing has been submitted or removed. Check your connection and try again. If your session expired, sign in again before reopening this step.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => reset()}
            className="min-h-11 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-900"
          >
            Try again
          </button>
          <Link
            href="/auth/sign-in"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-mist-100 px-5 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50"
          >
            Sign in again
          </Link>
        </div>
      </section>
    </main>
  )
}
