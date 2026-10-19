'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { buttonClass } from '@/components/ui/button'
import { runningIosHomeScreenApp } from '@/lib/pwa/display-mode'

type Intent = 'sign-in' | 'sign-up'

type Handoff =
  | { phase: 'closed' }
  | { phase: 'starting' }
  | { phase: 'started'; authorizeUrl: string; pairCode: string; expiresAt: number; step: 'open' | 'waiting' | 'confirm' }
  | { phase: 'signing-in' }
  | { phase: 'stopped'; reason: 'unavailable' | 'expired' | 'refused' | 'failed' }

const POLL_MS = 2500
const noSubscription = () => () => {}

const STOPPED_MESSAGES: Record<Extract<Handoff, { phase: 'stopped' }>['reason'], string> = {
  unavailable: 'Google sign-in cannot finish inside the Home Screen app right now.',
  expired: 'That Google sign-in expired before it reached the app.',
  refused: 'That Google sign-in was stopped after too many wrong codes.',
  failed: 'Google sign-in could not be completed for the app.',
}

/**
 * Round I (I3): "Continue with Google". In a browser it is the plain link to /auth/google/start. In the iPhone Home
 * Screen app, Google opens in a separate Safari window with its own cookies, so the link opens a panel instead that
 * explains this and runs the handoff (features/auth/app-handoff): the app shows a code, the member signs in with
 * Google in Safari and types the code there, and the app signs itself in. "Continue with email" is always offered,
 * because email sign-in works inside the app.
 */
export function GoogleStartLink({ intent, className, children }: { intent: Intent; className: string; children: ReactNode }) {
  // False on the server and in the first render, so the plain link always hydrates; the app check runs in the browser.
  const homeScreenApp = useSyncExternalStore(noSubscription, () => runningIosHomeScreenApp(window), () => false)
  const [handoff, setHandoff] = useState<Handoff>({ phase: 'closed' })
  const headingRef = useRef<HTMLHeadingElement>(null)

  const start = useCallback(async () => {
    setHandoff({ phase: 'starting' })
    try {
      const response = await fetch('/api/auth/app-handoff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent }),
        credentials: 'same-origin',
      })
      const body = await response.json() as { status?: string; authorizeUrl?: string; pairCode?: string; expiresInSeconds?: number }
      if (!response.ok || body.status !== 'started' || !body.authorizeUrl || !body.pairCode) {
        setHandoff({ phase: 'stopped', reason: 'unavailable' })
        return
      }
      setHandoff({
        phase: 'started',
        authorizeUrl: body.authorizeUrl,
        pairCode: body.pairCode,
        expiresAt: Date.now() + (body.expiresInSeconds ?? 600) * 1000,
        step: 'open',
      })
    } catch {
      setHandoff({ phase: 'stopped', reason: 'unavailable' })
    }
  }, [intent])

  const poll = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/app-handoff', { credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json() as { status?: string; redirectTo?: string }
      if (body.status === 'signed-in') {
        setHandoff({ phase: 'signing-in' })
        window.location.assign(body.redirectTo ?? '/auth/post-sign-in')
        return
      }
      if (body.status === 'confirm') {
        setHandoff((current) => current.phase === 'started' ? { ...current, step: 'confirm' } : current)
        return
      }
      if (body.status === 'expired' || body.status === 'refused' || body.status === 'failed') {
        setHandoff({ phase: 'stopped', reason: body.status })
      }
    } catch {
      // A dropped request is retried on the next tick.
    }
  }, [])

  const started = handoff.phase === 'started'
  const expiresAt = started ? handoff.expiresAt : 0
  useEffect(() => {
    if (!started) return
    const timer = window.setInterval(() => {
      if (Date.now() > expiresAt) {
        setHandoff({ phase: 'stopped', reason: 'expired' })
        return
      }
      void poll()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [started, expiresAt, poll])

  useEffect(() => {
    if (handoff.phase !== 'closed') headingRef.current?.focus()
  }, [handoff.phase])

  function continueWithEmail() {
    setHandoff({ phase: 'closed' })
    const email = document.querySelector<HTMLInputElement>('input[name="email"]')
    email?.focus()
  }

  return (
    <>
      <a
        href={`/auth/google/start?intent=${intent}`}
        className={className}
        aria-expanded={homeScreenApp ? handoff.phase !== 'closed' : undefined}
        onClick={(event) => {
          if (!homeScreenApp) return
          event.preventDefault()
          if (handoff.phase === 'closed' || handoff.phase === 'stopped') void start()
        }}
      >
        {children}
      </a>
      {homeScreenApp && handoff.phase !== 'closed' ? (
        <section
          aria-labelledby={`google-app-handoff-${intent}`}
          className="grid gap-3 rounded-xl border border-ocean-100 bg-ocean-50/60 p-4 text-left text-sm leading-6 text-navy-950"
          data-google-app-handoff
        >
          <h2 id={`google-app-handoff-${intent}`} ref={headingRef} tabIndex={-1} className="font-heading text-base font-bold">
            Google sign-in in the Home Screen app
          </h2>
          <p>
            On iPhone, Google opens in a separate Safari window, and Safari keeps its own sign-in, apart from this app.
            To bring your sign-in back here, use the code below.
          </p>
          {handoff.phase === 'starting' ? <p role="status">Getting a code…</p> : null}
          {handoff.phase === 'started' ? (
            <>
              <ol className="grid list-decimal gap-1 pl-5">
                <li>Tap <strong>Open Google sign-in</strong> and sign in with Google.</li>
                <li>On the page that opens, enter this code:</li>
              </ol>
              <p className="text-center font-heading text-3xl font-bold tracking-[0.2em]">
                <span className="sr-only">Code: {handoff.pairCode.replace(/\s/g, '').split('').join(' ')}</span>
                <span aria-hidden="true">{handoff.pairCode}</span>
              </p>
              <ol start={3} className="grid list-decimal gap-1 pl-5">
                <li>Come back to this app. It signs you in by itself.</li>
              </ol>
              <a
                href={handoff.authorizeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass()}
                onClick={() => setHandoff((current) => current.phase === 'started' ? { ...current, step: 'waiting' } : current)}
              >
                Open Google sign-in
              </a>
              <p role="status" aria-live="polite" className="text-muted">
                {handoff.step === 'open'
                  ? 'The code works for 10 minutes.'
                  : handoff.step === 'confirm'
                    ? 'Google is done. Enter the code in the Safari window, then come back here.'
                    : 'Waiting for Google…'}
              </p>
            </>
          ) : null}
          {handoff.phase === 'signing-in' ? <p role="status">Signing you in…</p> : null}
          {handoff.phase === 'stopped' ? (
            <p role="alert" className="font-semibold">{STOPPED_MESSAGES[handoff.reason]}</p>
          ) : null}
          <div className="grid gap-2">
            {handoff.phase === 'stopped' ? (
              <button type="button" className={buttonClass('secondary')} onClick={() => void start()}>
                Try Google again
              </button>
            ) : null}
            <button type="button" className={buttonClass(handoff.phase === 'stopped' ? 'primary' : 'secondary')} onClick={continueWithEmail}>
              Continue with email
            </button>
            <p className="text-muted">Email and password sign-in works inside the app and keeps you signed in here.</p>
          </div>
        </section>
      ) : null}
    </>
  )
}
