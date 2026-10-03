'use client'

import Link from 'next/link'
import { useEffect, useSyncExternalStore } from 'react'
import { RefreshCw, TriangleAlert, WifiOff } from 'lucide-react'
import { isStaleAssetError, recoverFromStaleAssets } from '@/lib/stale-assets'

export type RouteErrorKind = 'stale' | 'offline' | 'general'

export function classifyRouteError(error: unknown, online = true): RouteErrorKind {
  if (isStaleAssetError(error)) return 'stale'
  if (!online) return 'offline'
  return 'general'
}

function subscribeToConnection(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const COPY: Record<RouteErrorKind, { eyebrow: string; title: string; body: string }> = {
  stale: {
    eyebrow: 'A newer version is available',
    title: 'Sea N Shore was updated while this page was open.',
    body: 'Reload to get the latest version. Your account and data have not been changed.',
  },
  offline: {
    eyebrow: 'No connection',
    title: 'You appear to be offline.',
    body: 'Check your internet connection, then try again. Anything you already saved is safe.',
  },
  general: {
    eyebrow: 'This page could not load',
    title: 'Something went wrong while loading this page.',
    body: 'Your account and data have not been changed. Try again; if it keeps happening, go back to Home and retry in a few minutes, or visit Help.',
  },
}

/**
 * Shared body for error.tsx boundaries: says what happened, offers retry,
 * reload and a way out, and shows a reference code for support.
 */
export function RouteErrorView({
  error,
  retry,
  homeHref = '/home',
  homeLabel = 'Go to Home',
  compact = false,
  landmark = true,
}: {
  error: Error & { digest?: string }
  retry: () => void
  homeHref?: string
  homeLabel?: string
  /** Inside the app shell (header/nav stay visible) rather than a full screen. */
  compact?: boolean
  /** False when the surrounding layout already renders the page's <main> landmark. */
  landmark?: boolean
}) {
  const online = useSyncExternalStore(subscribeToConnection, () => navigator.onLine, () => true)
  const kind = classifyRouteError(error, online)
  const copy = COPY[kind]

  useEffect(() => {
    console.error('[app_route_error]', { digest: error.digest ?? 'none', name: error.name })
    // A missing JavaScript chunk means the browser runs an older build than the
    // one deployed. One hard reload picks up the current build; the helper
    // guards against a reload loop.
    if (isStaleAssetError(error)) recoverFromStaleAssets(window)
  }, [error])

  const Icon = kind === 'offline' ? WifiOff : TriangleAlert
  const Root = landmark ? 'main' : 'div'
  const rootProps = landmark ? { id: 'main-content' } : {}

  return (
    <Root {...rootProps} className={`grid place-items-center ${landmark ? 'px-4' : ''} ${compact ? 'min-h-[55vh] py-8' : 'min-h-[65vh] py-10'}`}>
      <section role="alert" className="w-full max-w-lg rounded-[1.75rem] border border-mist-100 bg-white p-7 text-center shadow-[var(--shadow-card)] sm:p-9">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-red-50 text-red-700">
          <Icon aria-hidden="true" className="size-6" />
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[.16em] text-ocean-700">{copy.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-950 sm:text-3xl">{copy.title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">{copy.body}</p>
        <div className="mt-7 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {kind === 'stale' ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Reload page
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={retry}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700"
              >
                <RefreshCw aria-hidden="true" className="size-4" />
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-mist-200 px-5 text-sm font-semibold text-navy-950 hover:bg-mist-50"
              >
                Reload page
              </button>
            </>
          )}
          <Link href={homeHref} className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-ocean-700 hover:bg-mist-50">
            {homeLabel}
          </Link>
        </div>
        <p className="mt-5 text-xs text-muted">
          Still stuck? <Link href="/help" className="font-semibold text-ocean-700 hover:underline">Get help</Link>
          {error.digest ? <> · Reference <span className="font-mono">{error.digest}</span></> : null}
        </p>
      </section>
    </Root>
  )
}
