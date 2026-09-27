'use client'

import './globals.css'
import { useEffect } from 'react'

/**
 * Replaces the root layout when the layout itself fails. It renders its own
 * document, so it avoids app components and keeps to plain markup.
 */
export default function GlobalError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string }
  retry?: () => void
  reset?: () => void
}) {
  useEffect(() => {
    console.error('[global_route_error]', { digest: error.digest ?? 'none', name: error.name })
  }, [error])

  return (
    <html lang="en">
      <body className="bg-mist-50">
        <title>Sea N Shore is temporarily unavailable</title>
        <main className="grid min-h-screen place-items-center px-4 py-10">
          <section role="alert" className="w-full max-w-lg rounded-[1.75rem] border border-mist-100 bg-white p-7 text-center shadow-[var(--shadow-card)] sm:p-9">
            <p className="text-lg font-bold text-navy-950">Sea N Shore</p>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[.16em] text-ocean-700">Temporarily unavailable</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-950 sm:text-3xl">We could not load Sea N Shore just now.</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
              Your account and data have not been changed. Try again in a moment. If it keeps happening, check your connection or come back in a few minutes.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => (retry ?? reset)?.()}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700"
              >
                Try again
              </button>
              {/* A full navigation is intentional: the app shell itself failed to render. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-mist-200 px-5 text-sm font-semibold text-navy-950 hover:bg-mist-50">
                Go to the home page
              </a>
            </div>
            {error.digest ? <p className="mt-5 text-xs text-muted">Reference <span className="font-mono">{error.digest}</span></p> : null}
          </section>
        </main>
      </body>
    </html>
  )
}
