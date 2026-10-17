'use client'

import { useId, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { EyeOff, MessageSquareReply, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { deleteCourseReviewReply, saveCourseReviewReply } from '../course-review-reply-actions'
import { REVIEW_REPLY_MAX_LENGTH, replyCharactersLeft } from '../course-review-reply-rules'
import type { CourseReviewReply, OwnerCourseReviewReply } from '../course-rating-repository'

/**
 * Round H: the course owner's reply under a review. Everyone sees a visible reply labelled "Reply from <publisher>";
 * the course owner also gets Reply / Edit / Delete, and sees a reply an administrator hid, marked as hidden.
 */

function replyDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value))
}

export function CourseReviewReplyDisplay({
  publisherName,
  reply,
  hidden = false,
}: {
  publisherName: string
  reply: CourseReviewReply
  hidden?: boolean
}) {
  const label = `Reply from ${publisherName}`
  return (
    <div role="group" aria-label={label} className="mt-3 rounded-xl border-l-4 border-ocean-200 bg-mist-50 px-4 py-3 max-md:px-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm font-bold text-navy-950">{label}</p>
        <time dateTime={reply.repliedAt} className="text-xs text-muted">{replyDate(reply.repliedAt)}</time>
        {hidden ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800">
            <EyeOff aria-hidden="true" className="size-3.5" /> Hidden by Sea N Shore moderators
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-7 text-navy-900">{reply.body}</p>
      {hidden ? (
        <p className="mt-1.5 text-xs leading-5 text-muted">Only your course team sees this reply. It stays hidden after edits until a moderator restores it.</p>
      ) : null}
    </div>
  )
}

const fieldClass = 'mt-1.5 w-full resize-y rounded-xl border bg-white px-3.5 py-2.5 text-[15px] leading-6 text-navy-950 outline-none placeholder:text-muted focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100 disabled:bg-mist-50'

export function CourseReviewReplyForm({
  reviewId,
  publisherName,
  initialBody = '',
  mode,
  onSaved,
  onCancel,
}: {
  reviewId: string
  publisherName: string
  initialBody?: string
  mode: 'add' | 'edit'
  onSaved: (reply: OwnerCourseReviewReply | null) => void
  onCancel: () => void
}) {
  const id = useId()
  const [body, setBody] = useState(initialBody)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const tooLong = body.length > REVIEW_REPLY_MAX_LENGTH

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!body.trim()) {
      setError('Write your reply before saving.')
      return
    }
    if (tooLong) {
      setError('Your reply can be at most 2,000 characters.')
      return
    }
    startTransition(async () => {
      const result = await saveCourseReviewReply({ reviewId, body, mode })
      if (!result.ok) {
        setError(result.fieldErrors?.body?.[0] ?? result.error)
        return
      }
      onSaved(result.reply)
    })
  }

  const describedBy = [`${id}-hint`, `${id}-count`, error ? `${id}-error` : null].filter(Boolean).join(' ')

  return (
    <form onSubmit={submit} noValidate aria-label={mode === 'add' ? 'Reply to this review' : 'Edit the reply to this review'} className="mt-3 space-y-2">
      <div>
        <label htmlFor={`${id}-body`} className="block text-sm font-bold text-navy-950">
          {mode === 'add' ? 'Your reply' : 'Edit your reply'}
        </label>
        <p id={`${id}-hint`} className="mt-0.5 text-xs leading-5 text-muted">Shown under the review as “Reply from {publisherName}”. Plain text; line breaks are kept.</p>
        <textarea
          id={`${id}-body`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${fieldClass} ${error ? 'border-red-400' : 'border-mist-200'}`}
        />
        <p id={`${id}-count`} aria-live="polite" className={`mt-1 text-xs ${tooLong ? 'font-semibold text-red-700' : 'text-muted'}`}>
          {replyCharactersLeft(body.length)}
        </p>
        {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-sm font-semibold text-red-700">{error}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2 max-md:flex-col">
        <Button type="submit" size="sm" disabled={pending} className="max-md:w-full">
          {pending ? 'Saving…' : mode === 'add' ? 'Post reply' : 'Save reply'}
        </Button>
        <Button variant="secondary" size="sm" disabled={pending} onClick={onCancel} className="max-md:w-full">Cancel</Button>
      </div>
    </form>
  )
}

/** The course owner's controls for one review: the reply (hidden ones included) with Edit and Delete, or Reply. */
export function CourseReviewOwnerReply({
  reviewId,
  publisherName,
  reply: initialReply,
}: {
  reviewId: string
  publisherName: string
  reply: OwnerCourseReviewReply | null
}) {
  const router = useRouter()
  const [reply, setReply] = useState(initialReply)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function saved(next: OwnerCourseReviewReply | null) {
    const added = !reply
    setReply(next)
    setEditing(false)
    setMessage({ tone: 'success', text: added ? 'Reply posted.' : 'Reply saved.' })
    router.refresh()
  }

  function remove() {
    setMessage(null)
    startTransition(async () => {
      const result = await deleteCourseReviewReply({ reviewId })
      setConfirmingDelete(false)
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error })
        return
      }
      setReply(null)
      setMessage({ tone: 'success', text: 'Reply deleted.' })
      router.refresh()
    })
  }

  const status = message ? (
    <p role="status" className={`mt-2 text-sm font-semibold ${message.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{message.text}</p>
  ) : null

  if (editing) {
    return (
      <>
        <CourseReviewReplyForm
          reviewId={reviewId}
          publisherName={publisherName}
          initialBody={reply?.body ?? ''}
          mode={reply ? 'edit' : 'add'}
          onSaved={saved}
          onCancel={() => setEditing(false)}
        />
        {status}
      </>
    )
  }

  if (!reply) {
    return (
      <div className="mt-3">
        <Button variant="secondary" size="sm" onClick={() => { setMessage(null); setEditing(true) }} className="max-md:w-full">
          <MessageSquareReply aria-hidden="true" className="size-4" /> Reply
        </Button>
        {status}
      </div>
    )
  }

  return (
    <div>
      <CourseReviewReplyDisplay publisherName={publisherName} reply={reply} hidden={reply.status === 'hidden'} />
      {confirmingDelete ? (
        <div role="group" aria-label="Delete this reply?" className="mt-2 flex flex-wrap items-center gap-2 max-md:flex-col max-md:items-stretch">
          <p className="text-sm font-semibold text-navy-950">Delete this reply?</p>
          <Button size="sm" disabled={pending} onClick={remove} className="bg-red-700 hover:bg-red-800 disabled:bg-red-700 max-md:w-full">
            {pending ? 'Deleting…' : 'Delete reply'}
          </Button>
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirmingDelete(false)} className="max-md:w-full">Keep reply</Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2 max-md:flex-col">
          <Button variant="secondary" size="sm" onClick={() => { setMessage(null); setEditing(true) }} className="max-md:w-full">
            <Pencil aria-hidden="true" className="size-4" /> Edit reply
          </Button>
          <Button variant="quiet" size="sm" onClick={() => { setMessage(null); setConfirmingDelete(true) }} className="max-md:w-full">
            <Trash2 aria-hidden="true" className="size-4" /> Delete reply
          </Button>
        </div>
      )}
      {status}
    </div>
  )
}
