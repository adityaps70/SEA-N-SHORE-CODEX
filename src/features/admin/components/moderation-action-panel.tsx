'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CheckCircle2, Eye, RotateCcw, ShieldX, XCircle } from 'lucide-react'
import { moderateContent } from '../actions'
import type { ModerationAction, ModerationTargetType } from '@/features/moderation/types'

export function ModerationActionPanel({
  targetType,
  targetId,
  targetState,
}: {
  targetType: ModerationTargetType
  targetId: string
  targetState: string
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()
  const removed = targetState === 'removed' || targetState === 'closed' || targetState === 'cancelled'

  function run(action: ModerationAction) {
    setMessage('')
    startTransition(async () => {
      const result = await moderateContent({ targetType, targetId, action, note })
      if (!result.ok) {
        setMessage(result.error)
        return
      }
      setMessage('Moderation action saved.')
      setNote('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 rounded-2xl border border-mist-100 bg-mist-50/70 p-4">
      <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted">
        Moderator note
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Record why this decision was made."
          className="mt-2 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink outline-none focus:border-ocean-500"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run('reviewing')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-mist-200 bg-white px-3 text-xs font-bold text-navy-950 hover:bg-mist-50 disabled:opacity-60"
        >
          <Eye aria-hidden="true" className="size-3.5" /> Mark reviewing
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run('dismiss')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-mist-200 bg-white px-3 text-xs font-bold text-navy-950 hover:bg-mist-50 disabled:opacity-60"
        >
          <XCircle aria-hidden="true" className="size-3.5" /> Dismiss
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run('resolve')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
        >
          <CheckCircle2 aria-hidden="true" className="size-3.5" /> Resolve
        </button>
        {removed ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('restore')}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-ocean-700 px-3 text-xs font-bold text-white hover:bg-ocean-800 disabled:opacity-60"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" /> Restore content
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('remove')}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-60"
          >
            <ShieldX aria-hidden="true" className="size-3.5" /> Remove content
          </button>
        )}
      </div>

      {message ? (
        <p role="status" className={`text-xs font-semibold ${message === 'Moderation action saved.' ? 'text-emerald-700' : 'text-red-700'}`}>
          {message}
        </p>
      ) : null}
    </div>
  )
}
