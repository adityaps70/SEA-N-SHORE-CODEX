'use client'

import { useState, useTransition } from 'react'
import { unsubscribeFromLegacyReminder } from '@/features/legacy-invites/unsubscribe-actions'

export function LegacyUnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const [pending, startTransition] = useTransition()

  if (state === 'done') {
    return (
      <p role="status" className="text-sm leading-6 text-navy-950">
        You&apos;re unsubscribed. Sea N Shore will not email this address again.
      </p>
    )
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await unsubscribeFromLegacyReminder(token)
          setState(result.ok ? 'done' : 'failed')
        })}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? 'Unsubscribing…' : 'Unsubscribe'}
      </button>
      {state === 'failed' ? <p role="alert" className="mt-3 text-sm text-red-700">That didn’t work. Please try again in a moment.</p> : null}
    </div>
  )
}
