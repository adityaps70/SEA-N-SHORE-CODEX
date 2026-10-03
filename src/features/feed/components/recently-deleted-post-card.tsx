'use client'

import { RotateCcw, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { restoreDeletedPost } from '../actions'
import { POST_CATEGORY_LABELS, type RecentlyDeletedPost } from '../types'

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function RecentlyDeletedPostCard({ post }: { post: RecentlyDeletedPost }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  function restore() {
    if (pending) return
    setMessage('')
    setIsError(false)
    startTransition(async () => {
      const result = await restoreDeletedPost(post.id)
      if (!result.ok) {
        setIsError(true)
        setMessage(result.error)
        return
      }
      setMessage('Post restored.')
      router.refresh()
    })
  }

  return (
    <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-800">
              <Trash2 aria-hidden="true" className="size-3.5" />
              Recently deleted
            </span>
            <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold text-muted">
              {POST_CATEGORY_LABELS[post.category]}
            </span>
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-ink">
            {post.body.length > 700 ? `${post.body.slice(0, 700)}…` : post.body}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-2">
        <p><span className="font-semibold text-navy-950">Deleted:</span> {dateLabel(post.deletedAt)}</p>
        <p><span className="font-semibold text-navy-950">Recoverable until:</span> {dateLabel(post.purgeAfter)}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={restore}
          disabled={pending}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-ocean-700 px-4 text-sm font-bold text-white transition hover:bg-ocean-800 disabled:cursor-wait disabled:opacity-60"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          {pending ? 'Restoring…' : 'Restore post'}
        </button>
        <p className="text-xs leading-5 text-muted">Only posts you deleted yourself can be restored here.</p>
      </div>

      {message ? (
        <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold ${isError ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {message}
        </p>
      ) : null}
    </article>
  )
}
