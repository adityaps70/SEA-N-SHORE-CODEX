'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CheckCircle2, Eye, RotateCcw, ShieldX, XCircle } from 'lucide-react'
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
  const [isError, setIsError] = useState(false)
  const [activeAction, setActiveAction] = useState<ModerationAction | null>(null)
  const [pending, startTransition] = useTransition()
  const removed = targetState === 'removed' || targetState === 'closed' || targetState === 'cancelled' || targetState === 'suspended'
  const removeLabel = targetType === 'profile' ? 'Suspend profile' : 'Remove content'
  const restoreLabel = targetType === 'profile' ? 'Restore profile' : 'Restore content'

  function run(action: ModerationAction) {
    setMessage('')
    setIsError(false)

    if (action !== 'reviewing' && !note.trim()) {
      setIsError(true)
      setMessage('Add a moderation note before taking this action.')
      return
    }

    setActiveAction(action)
    setMessage('Saving moderation action…')

    startTransition(async () => {
      try {
        const response = await fetch('/api/admin/moderation', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ targetType, targetId, action, note }),
        })
        const result = await response.json() as { ok: boolean; error?: string }

        if (!response.ok || !result.ok) {
          setIsError(true)
          setMessage(result.error ?? 'The moderation action could not be saved. Please try again.')
          return
        }

        setMessage('Moderation action saved.')
        setNote('')
        router.refresh()
      } catch {
        setIsError(true)
        setMessage('The moderation request could not be completed. Refresh this page and try again.')
      } finally {
        setActiveAction(null)
      }
    })
  }

  function buttonLabel(action: ModerationAction, label: string) {
    return pending && activeAction === action ? 'Saving…' : label
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
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-mist-200 bg-white px-3 text-xs font-bold text-navy-950 hover:bg-mist-50 disabled:cursor-wait disabled:opacity-60"
        >
          <Eye aria-hidden="true" className="size-3.5" /> {buttonLabel('reviewing', 'Mark reviewing')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run('dismiss')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-mist-200 bg-white px-3 text-xs font-bold text-navy-950 hover:bg-mist-50 disabled:cursor-wait disabled:opacity-60"
        >
          <XCircle aria-hidden="true" className="size-3.5" /> {buttonLabel('dismiss', 'Dismiss')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run('resolve')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
        >
          <CheckCircle2 aria-hidden="true" className="size-3.5" /> {buttonLabel('resolve', 'Resolve')}
        </button>
        {removed ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('restore')}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-ocean-700 px-3 text-xs font-bold text-white hover:bg-ocean-800 disabled:cursor-wait disabled:opacity-60"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" /> {buttonLabel('restore', restoreLabel)}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('remove')}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-xs font-bold text-white hover:bg-red-800 disabled:cursor-wait disabled:opacity-60"
          >
            <ShieldX aria-hidden="true" className="size-3.5" /> {buttonLabel('remove', removeLabel)}
          </button>
        )}
      </div>

      {message ? (
        <p
          role="status"
          aria-live="polite"
          className={`rounded-xl px-3 py-2 text-xs font-semibold ${
            isError
              ? 'bg-red-50 text-red-800'
              : message === 'Moderation action saved.'
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-ocean-50 text-ocean-800'
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
