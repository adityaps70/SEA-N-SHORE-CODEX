'use client'

import { useEffect } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app_route_error]', { digest: error.digest ?? 'none' })
  }, [error])

  return (
    <main className="grid min-h-[65vh] place-items-center px-4 py-10">
      <section className="w-full max-w-lg rounded-[1.75rem] border border-mist-100 bg-white p-7 text-center shadow-[var(--shadow-card)] sm:p-9">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-red-50 text-red-700">
          <TriangleAlert aria-hidden="true" className="size-6" />
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[.16em] text-ocean-700">Unable to load this page</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-navy-950">Something interrupted this request.</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
          Your account and data have not been changed. Try the request again. If the problem continues, return to Home and retry later.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700"
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Try again
        </button>
      </section>
    </main>
  )
}
