'use client'

import { RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

const MIN_REASON_LENGTH = 10

export function DeletedPostRecoveryPanel({
  postId,
  recoverable,
}: {
  postId: string
  recoverable: boolean
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [pending, startTransition] = useTransition()

  function restore() {
    const normalizedReason = reason.trim()
    if (!recoverable || pending) return
    if (normalizedReason.length < MIN_REASON_LENGTH) {
      setIsError(true)
      setMessage(`Enter at least ${MIN_REASON_LENGTH} characters explaining why this post should be restored.`)
      return
    }

    setIsError(false)
    setMessage('Restoring post…')
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/deleted-posts/${postId}/restore`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: normalizedReason }),
        })
        const result = await response.json() as { ok: boolean; error?: string }
        if (!response.ok || !result.ok) {
          setIsError(true)
          setMessage(result.error ?? 'The post could not be restored.')
          return
        }
        setReason('')
        setMessage('Post restored.')
        router.refresh()
      } catch {
        setIsError(true)
        setMessage('The recovery request could not be completed. Refresh and try again.')
      }
    })
  }

  if (!recoverable) {
    return (
      <div className="rounded-xl border border-mist-100 bg-mist-50 p-3">
        <p className="text-xs font-semibold leading-5 text-muted">
          This post has passed its retention deadline and is no longer recoverable.
        </p>
        <button
          type="button"
          disabled
          className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl bg-mist-100 px-3 text-sm font-bold text-muted"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Recovery expired
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-ocean-100 bg-ocean-50/40 p-3">
      <label htmlFor={`recovery-reason-${postId}`} className="block text-xs font-bold uppercase tracking-[0.1em] text-navy-950">
        Recovery reason
      </label>
      <textarea
        id={`recovery-reason-${postId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Why is recovery appropriate?"
        className="mt-2 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={restore}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-ocean-700 px-3 text-sm font-bold text-white transition hover:bg-ocean-800 disabled:cursor-wait disabled:opacity-60"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          {pending ? 'Restoring…' : 'Restore post'}
        </button>
        {message ? (
          <p role="status" className={`text-xs font-semibold ${isError ? 'text-red-700' : 'text-emerald-700'}`}>
            {message}
          </p>
        ) : null}
      </div>
    </div>
  )
}
