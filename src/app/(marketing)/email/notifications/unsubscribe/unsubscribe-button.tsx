'use client'

import Link from '@/components/navigation/intent-link'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { unsubscribeFromNotificationEmail } from '@/features/notification-emails/actions'

/** Round H (H3): confirms the unsubscribe for the one email type the signed link names. */
export function NotificationUnsubscribeButton({ token, label }: { token: string; label: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const [pending, startTransition] = useTransition()

  if (state === 'done') {
    return (
      <p role="status" className="text-sm leading-6 text-navy-950">
        Your {label} are off. <Link href="/settings/notifications" className="font-semibold text-ocean-700 hover:underline">Turn them back on in Settings</Link>.
      </p>
    )
  }

  return (
    <div>
      <Button
        disabled={pending}
        aria-busy={pending}
        onClick={() => startTransition(async () => {
          const result = await unsubscribeFromNotificationEmail(token)
          setState(result.ok ? 'done' : 'failed')
        })}
      >
        {pending ? 'Turning off…' : `Turn off ${label}`}
      </Button>
      {state === 'failed' ? <p role="alert" className="mt-3 text-sm text-red-700">That didn’t work. Please try again, or turn these emails off in Settings.</p> : null}
    </div>
  )
}
