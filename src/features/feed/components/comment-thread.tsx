'use client'

import Link from 'next/link'
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addComment, setCommentReaction, type CommentActionState } from '../actions'
import {
  EMPTY_REACTION_SUMMARY,
  POST_REACTIONS,
  POST_REACTION_META,
  reactionCount,
  type FeedComment,
  type PostReactionType,
  type ReactionSummary,
} from '../types'
import { MentionInput, type SelectedMention } from './mention-input'
import { MentionText } from './mention-text'
import { ReactionDetailsModal } from './reaction-details-modal'
import { ReactionPicker } from './reaction-picker'

const initialState: CommentActionState = {}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function relativeTime(timestamp: string) {
  const seconds = Math.round((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`
  if (seconds < 86400) return `${Math.max(1, Math.round(seconds / 3600))}h`
  return `${Math.max(1, Math.round(seconds / 86400))}d`
}

function commentSummary(comment: FeedComment): ReactionSummary {
  return comment.reactionSummary ?? { ...EMPTY_REACTION_SUMMARY }
}

function CommentReactionCount({ summary, onOpen }: { summary: ReactionSummary; onOpen(): void }) {
  const total = reactionCount(summary)
  if (!total) return null
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${total} comment ${total === 1 ? 'reaction' : 'reactions'}`}
      className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1 text-[11px] text-muted transition hover:bg-mist-50 hover:text-ocean-700"
    >
      <span aria-hidden="true" className="inline-flex -space-x-0.5">
        {POST_REACTIONS.filter((reaction) => summary[reaction] > 0).map((reaction) => (
          <span key={reaction}>{POST_REACTION_META[reaction].emoji}</span>
        ))}
      </span>
      <span>{total}</span>
    </button>
  )
}

function ReplyComposer({ postId, parentCommentId, onDone }: { postId: string; parentCommentId: string; onDone(): void }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<SelectedMention[]>([])
  const [state, formAction, pending] = useActionState(async (previousState: CommentActionState, formData: FormData) => {
    const nextState = await addComment(previousState, formData)
    if (nextState.ok) {
      setBody('')
      setMentions([])
      onDone()
      router.refresh()
    }
    return nextState
  }, initialState)

  useEffect(() => {
    document.getElementById(`reply-${parentCommentId}`)?.focus()
  }, [parentCommentId])

  return (
    <form action={formAction} className="mt-2 flex items-end gap-2">
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="parentCommentId" value={parentCommentId} />
      <div className="min-w-0 flex-1">
        <label htmlFor={`reply-${parentCommentId}`} className="sr-only">Write a reply</label>
        <MentionInput
          id={`reply-${parentCommentId}`}
          name="body"
          rows={1}
          value={body}
          onChange={setBody}
          mentions={mentions}
          onMentionsChange={setMentions}
          placeholder="Write a reply…"
          className="min-h-10 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500"
        />
        {state.fieldErrors?.body ? <p className="mt-1 text-xs text-red-700">{state.fieldErrors.body[0]}</p> : null}
      </div>
      <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-navy-950 px-3 text-xs font-semibold text-white disabled:opacity-60">{pending ? 'Replying…' : 'Reply'}</button>
      {state.error ? <p role="alert" className="text-xs text-red-700">{state.error}</p> : null}
    </form>
  )
}

function CommentItem({
  postId,
  comment,
  rootCommentId,
  readOnly,
  isReply = false,
}: {
  postId: string
  comment: FeedComment
  rootCommentId: string
  readOnly: boolean
  isReply?: boolean
}) {
  const [reaction, setReaction] = useState<PostReactionType | null>(comment.viewerReaction ?? null)
  const [summary, setSummary] = useState<ReactionSummary>(() => commentSummary(comment))
  const [replying, setReplying] = useState(false)
  const [reactionsOpen, setReactionsOpen] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function changeReaction(next: PostReactionType | null) {
    if (readOnly || pending) return
    const previousReaction = reaction
    const previousSummary = summary
    const updated = { ...summary }
    if (previousReaction) updated[previousReaction] = Math.max(0, updated[previousReaction] - 1)
    if (next) updated[next] += 1
    setReaction(next)
    setSummary(updated)
    setError('')
    startTransition(async () => {
      const result = await setCommentReaction(comment.id, next)
      if (!result.ok) {
        setReaction(previousReaction)
        setSummary(previousSummary)
        setError(result.error)
      }
    })
  }

  return (
    <div id={`comment-${comment.id}`} className={`flex gap-2.5 ${isReply ? 'ml-8 border-l border-mist-100 pl-3' : ''}`} data-testid={isReply ? undefined : 'visible-top-level-comment'}>
      <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-mist-100 text-xs font-semibold text-navy-950">
        {comment.author.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={comment.author.avatarUrl} alt={`${comment.author.fullName}'s profile photo`} className="h-full w-full object-cover" />
        ) : initials(comment.author.fullName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-mist-50 px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link href={`/people/${comment.author.slug}`} className="text-sm font-semibold text-navy-950 hover:text-ocean-700">{comment.author.fullName}</Link>
            <span className="text-xs text-muted">{comment.author.rank ?? comment.author.headline ?? 'Maritime professional'}</span>
            <time dateTime={comment.createdAt} className="ml-auto text-[11px] text-muted">{relativeTime(comment.createdAt)}</time>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink"><MentionText body={comment.body} mentions={comment.mentions} /></p>
        </div>
        <div className="mt-0.5 flex min-h-8 items-center gap-1.5 px-1">
          <CommentReactionCount summary={summary} onOpen={() => setReactionsOpen(true)} />
          {!readOnly ? <ReactionPicker value={reaction} disabled={pending} onChange={changeReaction} compact /> : null}
          {!readOnly ? (
            <button type="button" onClick={() => setReplying((value) => !value)} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-navy-900 hover:bg-mist-50">Reply</button>
          ) : null}
        </div>
        {error ? <p role="alert" className="px-1 text-xs text-red-700">{error}</p> : null}
        {replying && !readOnly ? <ReplyComposer postId={postId} parentCommentId={rootCommentId} onDone={() => setReplying(false)} /> : null}
        <ReactionDetailsModal
          open={reactionsOpen}
          targetType="comment"
          targetId={comment.id}
          summary={summary}
          onClose={() => setReactionsOpen(false)}
        />
      </div>
    </div>
  )
}

export function CommentThread({
  postId,
  comments,
  readOnly = false,
  composerOpen = false,
}: {
  postId: string
  comments: FeedComment[]
  readOnly?: boolean
  composerOpen?: boolean
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<SelectedMention[]>([])
  const [state, formAction, pending] = useActionState(async (previousState: CommentActionState, formData: FormData) => {
    const nextState = await addComment(previousState, formData)
    if (nextState.ok) {
      setBody('')
      setMentions([])
      router.refresh()
    }
    return nextState
  }, initialState)
  const [visibleRootCount, setVisibleRootCount] = useState(1)

  const { roots, repliesByRoot } = useMemo(() => {
    const rootComments = comments.filter((comment) => !comment.parentCommentId).slice().reverse()
    const map = new Map<string, FeedComment[]>()
    for (const comment of comments) {
      if (!comment.parentCommentId) continue
      const current = map.get(comment.parentCommentId) ?? []
      current.push(comment)
      map.set(comment.parentCommentId, current)
    }
    return { roots: rootComments, repliesByRoot: map }
  }, [comments])

  useEffect(() => {
    if (composerOpen && !readOnly) document.getElementById(`comment-${postId}`)?.focus()
  }, [composerOpen, postId, readOnly])

  const visibleRoots = roots.slice(0, visibleRootCount)
  const remaining = Math.max(0, roots.length - visibleRoots.length)

  return (
    <div id={`comments-${postId}`} className="border-t border-mist-100 px-4 py-4 sm:px-5">
      {visibleRoots.length ? (
        <div className="space-y-3">
          {visibleRoots.map((comment) => (
            <div key={comment.id} className="space-y-2">
              <CommentItem postId={postId} comment={comment} rootCommentId={comment.id} readOnly={readOnly} />
              {(repliesByRoot.get(comment.id) ?? []).map((reply) => (
                <CommentItem key={reply.id} postId={postId} comment={reply} rootCommentId={comment.id} readOnly={readOnly} isReply />
              ))}
            </div>
          ))}
          {remaining > 0 ? (
            <button type="button" onClick={() => setVisibleRootCount((count) => Math.min(roots.length, count + 10))} className="min-h-9 rounded-lg px-2 text-sm font-semibold text-ocean-700 hover:bg-mist-50">
              View {remaining} more comments
            </button>
          ) : null}
        </div>
      ) : composerOpen && !readOnly ? (
        <p className="text-sm text-muted">Start the professional discussion.</p>
      ) : null}

      {composerOpen && !readOnly ? (
        <form action={formAction} className="mt-3 flex items-end gap-2">
          <input type="hidden" name="postId" value={postId} />
          <div className="min-w-0 flex-1">
            <label htmlFor={`comment-${postId}`} className="sr-only">Add a comment</label>
            <MentionInput
              id={`comment-${postId}`}
              name="body"
              rows={1}
              value={body}
              onChange={setBody}
              mentions={mentions}
              onMentionsChange={setMentions}
              placeholder="Add a professional comment…"
              className="min-h-11 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500"
            />
            {state.fieldErrors?.body ? <p className="mt-1 text-xs text-red-700">{state.fieldErrors.body[0]}</p> : null}
          </div>
          <button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? 'Adding…' : 'Comment'}</button>
        </form>
      ) : null}
      {state.error ? <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p> : null}
    </div>
  )
}
