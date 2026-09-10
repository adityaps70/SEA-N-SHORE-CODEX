'use client'

import { Ellipsis, MessageCircle } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import * as feedActions from '../actions'
import type { CommentActionState } from '../actions'
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

function CommentReactionSummary({ summary, onOpen }: { summary: ReactionSummary; onOpen(): void }) {
  const total = reactionCount(summary)
  if (!total) return null
  const activeReactions = POST_REACTIONS.filter((reaction) => summary[reaction] > 0)
  return (
    <>
      <button type="button" onClick={onOpen} aria-label="View comment reaction types" className="inline-flex min-h-8 items-center gap-0.5 rounded-lg px-1 text-[11px] transition hover:bg-mist-50">
        {activeReactions.map((reaction) => <span key={reaction}>{POST_REACTION_META[reaction].emoji}</span>)}
      </button>
      <button type="button" onClick={onOpen} aria-label={`View ${total} comment reactions`} className="min-h-8 rounded-lg px-1 text-[11px] text-muted transition hover:bg-mist-50 hover:text-ocean-700">
        {total} {total === 1 ? 'reaction' : 'reactions'}
      </button>
    </>
  )
}

function CommentReplySummary({ count }: { count: number }) {
  if (!count) return null
  return (
    <span aria-label={`${count} ${count === 1 ? 'reply' : 'replies'}`} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1 text-[11px] text-muted">
      <MessageCircle aria-hidden="true" className="size-4" />
      <span>{count}</span>
    </span>
  )
}

function selectedMentions(comment: FeedComment): SelectedMention[] {
  return (comment.mentions ?? []).map((mention) => ({ profileId: mention.profileId, label: mention.fullName }))
}

function firstActionError(state: CommentActionState) {
  if (state.error) return state.error
  return Object.values(state.fieldErrors ?? {}).flatMap((errors) => errors ?? [])[0] ?? 'We could not update this comment.'
}

function ReplyComposer({ postId, parentCommentId, onCreated, onDone }: {
  postId: string
  parentCommentId: string
  onCreated(comment: FeedComment): void
  onDone(): void
}) {
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<SelectedMention[]>([])
  const [state, formAction, pending] = useActionState(async (previousState: CommentActionState, formData: FormData) => {
    const nextState = await feedActions.addComment(previousState, formData)
    if (nextState.ok && nextState.comment) {
      onCreated(nextState.comment)
      setBody('')
      setMentions([])
      onDone()
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
        <MentionInput id={`reply-${parentCommentId}`} name="body" rows={1} value={body} onChange={setBody} mentions={mentions} onMentionsChange={setMentions} placeholder="Write a reply…" className="min-h-10 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500" />
        {state.fieldErrors?.body ? <p className="mt-1 text-xs text-red-700">{state.fieldErrors.body[0]}</p> : null}
      </div>
      <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-navy-950 px-3 text-xs font-semibold text-white disabled:opacity-60">{pending ? 'Replying…' : 'Reply'}</button>
      {state.error ? <p role="alert" className="text-xs text-red-700">{state.error}</p> : null}
    </form>
  )
}

function CommentItem({ postId, comment, rootCommentId, readOnly, isReply = false, replyCount = 0, onChanged, onDeleted, onCreatedReply }: {
  postId: string
  comment: FeedComment
  rootCommentId: string
  readOnly: boolean
  isReply?: boolean
  replyCount?: number
  onChanged(comment: FeedComment): void
  onDeleted(commentId: string, comment: FeedComment | null): void
  onCreatedReply(comment: FeedComment): void
}) {
  const [reaction, setReaction] = useState<PostReactionType | null>(comment.viewerReaction ?? null)
  const [summary, setSummary] = useState<ReactionSummary>(() => commentSummary(comment))
  const [replying, setReplying] = useState(false)
  const [reactionsOpen, setReactionsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)
  const [editMentions, setEditMentions] = useState<SelectedMention[]>(() => selectedMentions(comment))
  const [error, setError] = useState('')
  const [reactionPending, startReactionTransition] = useTransition()
  const [managementPending, startManagementTransition] = useTransition()
  const updatedAt = comment.updatedAt ?? comment.createdAt
  const edited = !comment.deleted && Number.isFinite(Date.parse(updatedAt)) && Date.parse(updatedAt) > Date.parse(comment.createdAt)

  function changeReaction(next: PostReactionType | null) {
    if (readOnly || reactionPending) return
    const previousReaction = reaction
    const previousSummary = summary
    const updated = { ...summary }
    if (previousReaction) updated[previousReaction] = Math.max(0, updated[previousReaction] - 1)
    if (next) updated[next] += 1
    setReaction(next)
    setSummary(updated)
    setError('')
    startReactionTransition(async () => {
      const result = await feedActions.setCommentReaction(comment.id, next)
      if (!result.ok) {
        setReaction(previousReaction)
        setSummary(previousSummary)
        setError(result.error)
      }
    })
  }

  function beginEdit() {
    setMenuOpen(false)
    setReplying(false)
    setEditBody(comment.body)
    setEditMentions(selectedMentions(comment))
    setError('')
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setEditBody(comment.body)
    setEditMentions(selectedMentions(comment))
    setError('')
  }

  function submitEdit(formData: FormData) {
    if (managementPending) return
    setError('')
    startManagementTransition(async () => {
      const result = await feedActions.updateComment({}, formData)
      if (!result.ok || !result.comment) {
        if (result.value !== undefined) setEditBody(result.value)
        setError(firstActionError(result))
        return
      }
      onChanged(result.comment)
      setEditing(false)
    })
  }

  function removeComment() {
    if (managementPending) return
    setMenuOpen(false)
    setError('')
    startManagementTransition(async () => {
      const result = await feedActions.deleteComment(comment.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onDeleted(result.commentId, result.comment)
    })
  }

  if (comment.deleted) {
    if (isReply) return null
    return (
      <div id={`comment-${comment.id}`} className="flex gap-2.5" data-testid="visible-top-level-comment">
        <div className="min-w-0 flex-1 rounded-2xl bg-mist-50 px-3 py-3"><p className="text-sm italic text-muted">Comment deleted</p></div>
      </div>
    )
  }

  return (
    <div id={`comment-${comment.id}`} className={`relative flex gap-2.5 ${isReply ? 'ml-8 pl-5' : ''}`} data-testid={isReply ? `reply-thread-${comment.id}` : 'visible-top-level-comment'}>
      {isReply ? <><span aria-hidden="true" className="absolute bottom-1/2 left-0 top-[-0.75rem] w-px bg-mist-100" /><span aria-hidden="true" className="absolute left-0 top-2 h-4 w-4 rounded-bl-xl border-b border-l border-mist-100" /></> : null}
      <div className="relative z-[1] grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-mist-100 text-xs font-semibold text-navy-950">
        {comment.author.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={comment.author.avatarUrl} alt={`${comment.author.fullName}'s profile photo`} className="h-full w-full object-cover" />
        ) : initials(comment.author.fullName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative rounded-2xl bg-mist-50 px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2 pr-7">
            <Link href={`/people/${comment.author.slug}`} className="text-sm font-semibold text-navy-950 hover:text-ocean-700">{comment.author.fullName}</Link>
            <span className="text-xs text-muted">{comment.author.rank ?? comment.author.headline ?? 'Maritime professional'}</span>
            <div className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted"><time dateTime={comment.createdAt}>{relativeTime(comment.createdAt)}</time>{edited ? <span>Edited</span> : null}</div>
          </div>
          {!readOnly && comment.viewerOwns ? (
            <div className="absolute right-1.5 top-1.5">
              <button type="button" aria-label="Comment actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)} className="grid size-7 place-items-center rounded-full text-muted transition hover:bg-white hover:text-navy-950"><Ellipsis className="size-4" aria-hidden="true" /></button>
              {menuOpen ? (
                <div className="absolute right-0 z-20 mt-1 min-w-24 overflow-hidden rounded-xl border border-mist-100 bg-white py-1 shadow-lg">
                  {comment.canEdit ? <button type="button" onClick={beginEdit} className="block w-full px-3 py-2 text-left text-xs font-semibold text-navy-950 hover:bg-mist-50">Edit</button> : null}
                  <button type="button" onClick={removeComment} disabled={managementPending} className="block w-full px-3 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">Delete</button>
                </div>
              ) : null}
            </div>
          ) : null}
          {editing ? (
            <form className="mt-2" onSubmit={(event) => { event.preventDefault(); submitEdit(new FormData(event.currentTarget)) }}>
              <input type="hidden" name="commentId" value={comment.id} />
              <label htmlFor={`edit-comment-${comment.id}`} className="sr-only">Edit comment</label>
              <MentionInput id={`edit-comment-${comment.id}`} name="body" rows={2} value={editBody} onChange={setEditBody} mentions={editMentions} onMentionsChange={setEditMentions} placeholder="Edit comment…" className="min-h-16 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500" />
              <div className="mt-2 flex items-center justify-end gap-2"><button type="button" onClick={cancelEdit} disabled={managementPending} className="min-h-8 rounded-lg px-3 text-xs font-semibold text-navy-900 hover:bg-white disabled:opacity-60">Cancel</button><button type="submit" disabled={managementPending} className="min-h-8 rounded-lg bg-navy-950 px-3 text-xs font-semibold text-white disabled:opacity-60">{managementPending ? 'Saving…' : 'Save'}</button></div>
            </form>
          ) : <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink"><MentionText body={comment.body} mentions={comment.mentions} /></p>}
        </div>
        {!editing ? (
          <div className="mt-0.5 flex min-h-8 items-center gap-1.5 px-1">
            <CommentReactionSummary summary={summary} onOpen={() => setReactionsOpen(true)} />
            <CommentReplySummary count={replyCount} />
            {!readOnly ? <ReactionPicker value={reaction} disabled={reactionPending} onChange={changeReaction} compact /> : null}
            {!readOnly ? <button type="button" onClick={() => setReplying((value) => !value)} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-navy-900 hover:bg-mist-50">Reply</button> : null}
          </div>
        ) : null}
        {error ? <p role="alert" className="px-1 text-xs text-red-700">{error}</p> : null}
        {replying && !readOnly && !editing ? <ReplyComposer postId={postId} parentCommentId={rootCommentId} onCreated={onCreatedReply} onDone={() => setReplying(false)} /> : null}
        <ReactionDetailsModal open={reactionsOpen} targetType="comment" targetId={comment.id} summary={summary} onClose={() => setReactionsOpen(false)} />
      </div>
    </div>
  )
}

export function CommentThread({ postId, comments, readOnly = false, composerOpen = false }: {
  postId: string
  comments: FeedComment[]
  readOnly?: boolean
  composerOpen?: boolean
}) {
  const [threadComments, setThreadComments] = useState(comments)
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<SelectedMention[]>([])
  const [visibleRootCount, setVisibleRootCount] = useState(1)

  function upsertComment(nextComment: FeedComment) {
    setThreadComments((current) => {
      const exists = current.some((comment) => comment.id === nextComment.id)
      if (exists) return current.map((comment) => comment.id === nextComment.id ? nextComment : comment)
      return [...current, nextComment]
    })
  }

  function reconcileDelete(commentId: string, nextComment: FeedComment | null) {
    setThreadComments((current) => nextComment ? current.map((comment) => comment.id === commentId ? nextComment : comment) : current.filter((comment) => comment.id !== commentId))
  }

  const [state, formAction, pending] = useActionState(async (previousState: CommentActionState, formData: FormData) => {
    const nextState = await feedActions.addComment(previousState, formData)
    if (nextState.ok && nextState.comment) {
      upsertComment(nextState.comment)
      setBody('')
      setMentions([])
    }
    return nextState
  }, initialState)

  const { roots, repliesByRoot } = useMemo(() => {
    const rootComments = threadComments.filter((comment) => !comment.parentCommentId).slice().reverse()
    const map = new Map<string, FeedComment[]>()
    for (const comment of threadComments) {
      if (!comment.parentCommentId) continue
      const current = map.get(comment.parentCommentId) ?? []
      current.push(comment)
      map.set(comment.parentCommentId, current)
    }
    return { roots: rootComments, repliesByRoot: map }
  }, [threadComments])

  useEffect(() => {
    if (composerOpen && !readOnly) document.getElementById(`comment-${postId}`)?.focus()
  }, [composerOpen, postId, readOnly])

  const visibleRoots = roots.slice(0, visibleRootCount)
  const remaining = Math.max(0, roots.length - visibleRoots.length)

  return (
    <div id={`comments-${postId}`} className="border-t border-mist-100 px-4 py-4 sm:px-5">
      {visibleRoots.length ? (
        <div className="space-y-3">
          {visibleRoots.map((comment) => {
            const replies = repliesByRoot.get(comment.id) ?? []
            return (
              <div key={comment.id} className="space-y-2">
                <CommentItem postId={postId} comment={comment} rootCommentId={comment.id} readOnly={readOnly} replyCount={replies.length} onChanged={upsertComment} onDeleted={reconcileDelete} onCreatedReply={upsertComment} />
                {replies.map((reply) => <CommentItem key={reply.id} postId={postId} comment={reply} rootCommentId={comment.id} readOnly={readOnly} isReply onChanged={upsertComment} onDeleted={reconcileDelete} onCreatedReply={upsertComment} />)}
              </div>
            )
          })}
          {remaining > 0 ? <button type="button" onClick={() => setVisibleRootCount((count) => Math.min(roots.length, count + 10))} className="min-h-9 rounded-lg px-2 text-sm font-semibold text-ocean-700 hover:bg-mist-50">View {remaining} more comments</button> : null}
        </div>
      ) : composerOpen && !readOnly ? <p className="text-sm text-muted">Start the professional discussion.</p> : null}

      {composerOpen && !readOnly ? (
        <form action={formAction} className="mt-3 flex items-end gap-2">
          <input type="hidden" name="postId" value={postId} />
          <div className="min-w-0 flex-1">
            <label htmlFor={`comment-${postId}`} className="sr-only">Add a comment</label>
            <MentionInput id={`comment-${postId}`} name="body" rows={1} value={body} onChange={setBody} mentions={mentions} onMentionsChange={setMentions} placeholder="Add a professional comment…" className="min-h-11 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500" />
            {state.fieldErrors?.body ? <p className="mt-1 text-xs text-red-700">{state.fieldErrors.body[0]}</p> : null}
          </div>
          <button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? 'Adding…' : 'Comment'}</button>
        </form>
      ) : null}
      {state.error ? <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p> : null}
    </div>
  )
}