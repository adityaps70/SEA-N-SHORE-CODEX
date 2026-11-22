'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CheckCircle2, Eye, RotateCcw, ShieldX, XCircle } from 'lucide-react'
import type { ModerationAction, ModerationTargetType } from '@/features/moderation/types'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'
import { moderateContent } from '../actions'

export function ModerationActionPanel({
  targetType,
  targetId,
  targetState,
  mode = 'platform',
  actions = ['reviewing', 'dismiss', 'resolve', 'remove', 'restore'],
}: {
  targetType: ModerationTargetType
  targetId: string
  targetState: string
  /**
   * Round GP Part E: 'country' is a country admin. Their decisions go through the moderateContent server action
   * (MFA-gated, scoped in SQL), never the platform-only /api/admin route; 'view' shows the case without controls.
   */
  mode?: 'platform' | 'country' | 'view'
  /** The actions offered (a country admin with Events only: cancel and restore an event). */
  actions?: readonly ModerationAction[]
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [activeAction, setActiveAction] = useState<ModerationAction | null>(null)
  const [pending, startTransition] = useTransition()
  const removed = targetState === 'removed' || targetState === 'closed' || targetState === 'cancelled' || targetState === 'suspended'
  const removeLabel = targetType === 'profile' ? 'Suspend profile' : targetType === 'event' ? 'Cancel event' : 'Remove content'
  const restoreLabel = targetType === 'profile' ? 'Restore profile' : targetType === 'event' ? 'Restore event' : 'Restore content'

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
        let result: { ok: boolean; error?: string }
        let responseOk = true
        if (mode === 'country') {
          result = await moderateContent({ targetType, targetId, action, note })
        } else {
          const response = await fetch('/api/admin/moderation', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ targetType, targetId, action, note }),
          })
          responseOk = response.ok
          result = await response.json() as { ok: boolean; error?: string }
        }

        if (!responseOk || !result.ok) {
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

  if (mode === 'view' || (mode === 'country' && targetType === 'profile')) {
    return (
      <div className="rounded-2xl border border-mist-100 bg-mist-50/70 p-4 text-sm text-muted">
        {targetType === 'profile'
          ? 'Only Sea N Shore administrators act on reported member profiles.'
          : 'View only: decisions are not part of your country admin access.'}
      </div>
    )
  }
  const offers = (action: ModerationAction) => actions.includes(action)

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
        {offers('reviewing') ? <button
          type="button"
          disabled={pending}
          onClick={() => run('reviewing')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-mist-200 bg-white px-3 text-xs font-bold text-navy-950 hover:bg-mist-50 disabled:cursor-wait disabled:opacity-60"
        >
          <Eye aria-hidden="true" className="size-3.5" /> {buttonLabel('reviewing', 'Mark reviewing')}
        </button> : null}
        {offers('dismiss') ? <button
          type="button"
          disabled={pending}
          onClick={() => run('dismiss')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-mist-200 bg-white px-3 text-xs font-bold text-navy-950 hover:bg-mist-50 disabled:cursor-wait disabled:opacity-60"
        >
          <XCircle aria-hidden="true" className="size-3.5" /> {buttonLabel('dismiss', 'Dismiss')}
        </button> : null}
        {offers('resolve') ? <button
          type="button"
          disabled={pending}
          onClick={() => run('resolve')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
        >
          <CheckCircle2 aria-hidden="true" className="size-3.5" /> {buttonLabel('resolve', 'Resolve')}
        </button> : null}
        {removed && !offers('restore') ? null : !removed && !offers('remove') ? null : removed ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run('restore')}
            className={cn(buttonClass({ variant: 'primary', size: 'sm' }), 'min-h-9 gap-1.5 px-3 text-xs disabled:cursor-wait')}
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
