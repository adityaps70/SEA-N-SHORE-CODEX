'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { HelpCircle, Monitor, Smartphone, Tablet } from 'lucide-react'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import { signOut } from '@/features/auth/actions'
import { signOutOtherSessionsAction, signOutSessionAction, type SessionActionState } from '../actions'
import type { DeviceKind } from '../user-agent'
import { alertClass, buttonRowClass, confirmBoxClass, statusClass } from './styles'

export type SessionListItem = {
  id: string
  device: string
  kind: DeviceKind
  location: string
  lastActive: string
  signedIn: string
  current: boolean
}

const NETWORK_ERROR = 'We could not reach Sea N Shore. Check your connection and try again.'

const icons: Record<DeviceKind, typeof Monitor> = {
  phone: Smartphone,
  tablet: Tablet,
  computer: Monitor,
  unknown: HelpCircle,
}

/**
 * Round H (H3): Settings › Account › Active sessions. One row per signed-in device, with "Sign out" on each and
 * "Sign out of all other devices"; each asks for confirmation first.
 */
export function SessionsList({ sessions }: { sessions: SessionListItem[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState<string | 'others' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const others = sessions.filter((session) => !session.current)

  function run(work: () => Promise<SessionActionState>) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      try {
        const result = await work()
        if (result.status === 'error') setError(result.error)
        if (result.status === 'done') {
          setNotice(result.message)
          setConfirming(null)
          router.refresh()
        }
      } catch {
        setError(NETWORK_ERROR)
      }
    })
  }

  return (
    <div className="mt-4 grid gap-4">
      {notice ? <p role="status" className={statusClass}>{notice}</p> : null}
      {error ? <p role="alert" className={alertClass}>{error}</p> : null}

      {sessions.length === 0 ? (
        <p className="rounded-xl bg-mist-50 px-3 py-2 text-sm text-muted">We couldn’t list your devices right now. Refresh the page to try again.</p>
      ) : (
        <ul className="grid gap-3">
          {sessions.map((session) => {
            const Icon = icons[session.kind]
            const headingId = `session-${session.id}`
            return (
              <li key={session.id} aria-labelledby={headingId} className="rounded-xl border border-mist-200 p-4">
                <div className="flex gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p id={headingId} className="flex flex-wrap items-center gap-2 font-semibold text-navy-950">
                      <span className="break-words">{session.device}</span>
                      {session.current ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">This device</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">{session.location}</p>
                    <p className="text-sm text-muted">{session.lastActive} · {session.signedIn}</p>
                  </div>
                </div>

                {confirming === session.id ? (
                  <div className={`mt-3 ${confirmBoxClass}`}>
                    <p className="text-sm leading-6 text-navy-950">
                      {session.current
                        ? 'Sign out of this device? You’ll need to sign in again here.'
                        : `Sign out of ${session.device}? That device will need to sign in again.`}
                    </p>
                    <div className={buttonRowClass}>
                      <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={secondaryButtonClass}>Cancel</button>
                      {session.current ? (
                        <form action={signOut}>
                          <button type="submit" className={`${primaryButtonClass} w-full`}>Sign out</button>
                        </form>
                      ) : (
                        <button type="button" disabled={pending} onClick={() => run(() => signOutSessionAction(session.id))} className={primaryButtonClass}>
                          {pending ? 'Signing out…' : 'Sign out'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={pending}
                      aria-describedby={headingId}
                      onClick={() => { setError(null); setNotice(null); setConfirming(session.id) }}
                      className={secondaryButtonClass}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {others.length > 0 ? (
        confirming === 'others' ? (
          <div className={confirmBoxClass}>
            <p className="text-sm leading-6 text-navy-950">
              Sign out of all other devices? {others.length === 1 ? 'That device' : `Those ${others.length} devices`} will need to sign in again. You stay signed in here.
            </p>
            <div className={buttonRowClass}>
              <button type="button" disabled={pending} onClick={() => setConfirming(null)} className={secondaryButtonClass}>Cancel</button>
              <button type="button" disabled={pending} onClick={() => run(() => signOutOtherSessionsAction())} className={primaryButtonClass}>
                {pending ? 'Signing out…' : 'Sign out of other devices'}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <button type="button" disabled={pending} onClick={() => { setError(null); setNotice(null); setConfirming('others') }} className={secondaryButtonClass}>
              Sign out of all other devices
            </button>
          </div>
        )
      ) : null}
    </div>
  )
}
