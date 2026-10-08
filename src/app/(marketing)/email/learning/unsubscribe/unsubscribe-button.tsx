'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { unsubscribeFromLearningEmails } from '@/features/learning/learning-email-actions'

export function LearningUnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const [pending, startTransition] = useTransition()

  if (state === 'done') {
    return (
      <p role="status" className="text-sm leading-6 text-navy-950">
        Learning emails are off. <Link href="/settings/notifications" className="font-semibold text-ocean-700 hover:underline">Turn them back on in Settings</Link>.
      </p>
    )
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await unsubscribeFromLearningEmails(token)
          setState(result.ok ? 'done' : 'failed')
        })}
        className="inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? 'Turning off…' : 'Turn off learning emails'}
      </button>
      {state === 'failed' ? <p role="alert" className="mt-3 text-sm text-red-700">That didn’t work. Please try again, or turn the emails off in Settings.</p> : null}
    </div>
  )
}
