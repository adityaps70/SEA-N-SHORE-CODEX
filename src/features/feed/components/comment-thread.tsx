'use client'

import Link from 'next/link'
import { useActionState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { addComment, type CommentActionState } from '../actions'
import type { FeedComment } from '../types'

const initialState: CommentActionState = {}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function CommentThread({ postId, comments }: { postId: string; comments: FeedComment[] }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, pending] = useActionState(addComment, initialState)

  useEffect(() => {
    if (!state.ok) return
    formRef.current?.reset()
    router.refresh()
  }, [state.ok, router])

  return (
    <div id={`comments-${postId}`} className="border-t border-mist-100 px-4 py-4 sm:px-5">
      {comments.length ? (
        <div className="space-y-3">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-2.5">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-mist-100 text-xs font-semibold text-navy-950">
                {initials(comment.author.fullName)}
              </div>
              <div className="min-w-0 flex-1 rounded-2xl bg-mist-50 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/people/${comment.author.slug}`} className="text-sm font-semibold text-navy-950 hover:text-ocean-700">
                    {comment.author.fullName}
                  </Link>
                  <span className="text-xs text-muted">{comment.author.rank ?? comment.author.headline ?? 'Maritime professional'}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{comment.body}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Start the professional discussion.</p>
      )}

      <form ref={formRef} action={formAction} className="mt-3 flex items-end gap-2">
        <input type="hidden" name="postId" value={postId} />
        <div className="min-w-0 flex-1">
          <label htmlFor={`comment-${postId}`} className="sr-only">Add a comment</label>
          <textarea
            id={`comment-${postId}`}
            name="body"
            rows={1}
            defaultValue={state.value ?? ''}
            placeholder="Add a professional comment…"
            className="min-h-11 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2.5 text-sm text-ink placeholder:text-muted"
          />
          {state.fieldErrors?.body ? <p className="mt-1 text-xs text-red-700">{state.fieldErrors.body[0]}</p> : null}
        </div>
        <button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? 'Adding…' : 'Comment'}
        </button>
      </form>
      {state.error ? <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p> : null}
    </div>
  )
}
