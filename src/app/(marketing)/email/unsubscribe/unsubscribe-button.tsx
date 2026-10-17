'use client'

import Link from '@/components/navigation/intent-link'
import { useState, useTransition } from 'react'
import { unsubscribeFromRankingEmail } from '@/features/ranking/ranking-email-actions'

const DONE = { job_alerts: 'Job alert emails are off.', weekly_digest: 'The weekly digest is off.' } as const
const BUTTON = { job_alerts: 'Turn off job alert emails', weekly_digest: 'Turn off the weekly digest' } as const

export function RankingUnsubscribeButton({ token, topic }: { token: string; topic: keyof typeof DONE }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const [pending, startTransition] = useTransition()

  if (state === 'done') {
    return (
      <p role="status" className="text-sm leading-6 text-navy-950">
        {DONE[topic]} <Link href="/settings/notifications" className="font-semibold text-ocean-700 hover:underline">Turn it back on in Settings</Link>.
      </p>
    )
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await unsubscribeFromRankingEmail(token)
          setState(result.ok ? 'done' : 'failed')
        })}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? 'Turning off…' : BUTTON[topic]}
      </button>
      {state === 'failed' ? <p role="alert" className="mt-3 text-sm text-red-700">That didn’t work. Please try again, or turn the emails off in Settings.</p> : null}
    </div>
  )
}
