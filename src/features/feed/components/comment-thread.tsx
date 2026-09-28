'use client'

import { ChevronDown, ChevronUp, CornerDownRight, Ellipsis, Flag, MessageCircle, PencilLine, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode, type RefObject } from 'react'
import {
  MobileSheetBackdrop,
  MobileSheetCancel,
  MobileSheetGrab,
  SHEET_MENU_ITEM_CLASS,
  SHEET_MENU_PANEL_CLASS,
} from '@/components/ui/mobile-sheet'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'
import * as feedActions from '../actions'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import type { CommentActionState } from '../actions'
import {
  EMPTY_REACTION_SUMMARY,
  reactionCount,
  type FeedComment,
  type PostReactionType,
  type ReactionSummary,
} from '../types'
import { AuthorAvatarLink, profileHref } from './author-avatar'
import { EmojiPicker, insertEmojiAt } from './emoji-picker'
import { COMMENT_COLLAPSE, ExpandableText } from './expandable-text'
import { MentionInput, type SelectedMention } from './mention-input'
import { ReactionDetailsModal } from './reaction-details-modal'
import { ReactionPicker } from './reaction-picker'
import { ReactionSummaryTrigger } from './reaction-summary'

const initialState: CommentActionState = {}

/** Threads with more replies than this start collapsed behind "View N replies". */
export const REPLY_PREVIEW_LIMIT = 2

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

/** Inserts an emoji at the caret of a controlled textarea and restores focus after it. */
function useEmojiInsertion(value: string, setValue: (value: string) => void) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const insert = useCallback((emoji: string) => {
    const textarea = textareaRef.current
    const next = insertEmojiAt(value, emoji, textarea?.selectionStart, textarea?.selectionEnd)
    setValue(next.value)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }, [setValue, value])
  return { textareaRef, insert }
}

function ReplyComposer({ postId, target, onCreated, onDone }: {
  postId: string
  target: FeedComment
  onCreated(comment: FeedComment): void
  onDone(): void
}) {
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<SelectedMention[]>([])
  const { textareaRef, insert } = useEmojiInsertion(body, setBody)
  const inputId = `reply-${target.id}`
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
    document.getElementById(inputId)?.focus()
  }, [inputId])

  return (
    <form action={formAction} className="mt-2" aria-label={`Reply to ${target.author.fullName}`}>
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="parentCommentId" value={target.id} />
      <p className="mb-1 flex items-center gap-1 px-1 text-xs text-muted">
        <CornerDownRight aria-hidden="true" className="size-3.5" />
        Replying to <span className="font-semibold text-navy-900">{target.author.fullName}</span>
      </p>
      <div className="flex items-end gap-1.5">
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="sr-only">Write a reply to {target.author.fullName}</label>
          <MentionInput id={inputId} name="body" rows={1} value={body} onChange={setBody} mentions={mentions} onMentionsChange={setMentions} textareaRef={textareaRef} maxLength={2000} placeholder="Write a reply…" className="min-h-10 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500" />
        </div>
        <EmojiPicker onSelect={insert} label="Add emoji to reply" align="right" size="sm" />
        <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-navy-950 px-3 text-xs font-semibold text-white disabled:opacity-60 enabled:hover:bg-navy-800 transition-colors disabled:cursor-not-allowed">{pending ? 'Replying…' : 'Reply'}</button>
      </div>
      {state.fieldErrors?.body ? <p className="mt-1 px-1 text-xs text-red-700">{state.fieldErrors.body[0]}</p> : null}
      {state.error ? <p role="alert" className="mt-1 px-1 text-xs text-red-700">{state.error}</p> : null}
    </form>
  )
}

const menuItemClass = `flex w-full cursor-pointer items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-xs font-semibold hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 max-md:rounded-xl ${SHEET_MENU_ITEM_CLASS}`

/**
 * The comment "⋯" menu (a bottom sheet on phones, a dropdown from md). Owners get Edit (inside the edit window) and Delete; everyone else gets
 * Report, so the action row only holds Like and Reply.
 */
function CommentActionsMenu({ owner, canEdit, pending, onEdit, onDelete, onReport, triggerRef }: {
  owner: boolean
  canEdit: boolean
  pending: boolean
  onEdit(): void
  onDelete(): void
  onReport(): void
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, close, { triggerRef })
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [open])

  function run(action: () => void) {
    return () => {
      setOpen(false)
      action()
    }
  }

  return (
    <div ref={rootRef} className="absolute right-1.5 top-1.5 max-md:right-0.5 max-md:top-0.5">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Comment actions"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid size-7 max-md:size-9 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-white hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40"
      >
        <Ellipsis className="size-4" aria-hidden="true" />
      </button>
      {open ? <MobileSheetBackdrop onClose={close} /> : null}
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Comment actions"
          className={`absolute right-0 z-20 mt-1 w-max min-w-32 overflow-hidden rounded-xl border border-mist-100 bg-white py-1 shadow-lg ${SHEET_MENU_PANEL_CLASS}`}
        >
          <MobileSheetGrab />
          {owner ? (
            <>
              {canEdit ? (
                <button type="button" role="menuitem" onClick={run(onEdit)} className={`${menuItemClass} text-navy-950`}>
                  <PencilLine aria-hidden="true" className="size-3.5" /> Edit
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={run(onDelete)} disabled={pending} className={`${menuItemClass} text-red-700 hover:bg-red-50`}>
                <Trash2 aria-hidden="true" className="size-3.5" /> Delete
              </button>
            </>
          ) : (
            <button type="button" role="menuitem" onClick={run(onReport)} className={`${menuItemClass} text-red-700 hover:bg-red-50`}>
              <Flag aria-hidden="true" className="size-3.5" /> Report comment
            </button>
          )}
          <MobileSheetCancel onClick={() => { setOpen(false); triggerRef.current?.focus() }} />
        </div>
      ) : null}
    </div>
  )
}

function CommentItem({ postId, postAuthorId, comment, rootComment, readOnly, isReply = false, replyCount = 0, onChanged, onDeleted, onCreatedReply }: {
  postId: string
  postAuthorId?: string
  comment: FeedComment
  rootComment: FeedComment
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
  const [reportOpen, setReportOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)
  const [editMentions, setEditMentions] = useState<SelectedMention[]>(() => selectedMentions(comment))
  const [error, setError] = useState('')
  const [reactionPending, startReactionTransition] = useTransition()
  const [managementPending, startManagementTransition] = useTransition()
  const { textareaRef: editTextareaRef, insert: insertEditEmoji } = useEmojiInsertion(editBody, setEditBody)
  const updatedAt = comment.updatedAt ?? comment.createdAt
  const edited = !comment.deleted && Number.isFinite(Date.parse(updatedAt)) && Date.parse(updatedAt) > Date.parse(comment.createdAt)
  const replyTarget = isReply
    ? comment.replyTo ?? { commentId: rootComment.id, authorName: rootComment.author.fullName, authorSlug: rootComment.author.slug }
    : null
  const isPostAuthor = Boolean(postAuthorId) && comment.author.id === postAuthorId

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

  const avatarSize = isReply ? 'size-8 rounded-lg text-[11px]' : 'size-9 rounded-xl text-xs'

  return (
    <div
      id={`comment-${comment.id}`}
      className="relative flex gap-2.5"
      data-testid={isReply ? `reply-thread-${comment.id}` : 'visible-top-level-comment'}
      data-comment-level={isReply ? 'reply' : 'parent'}
    >
      <AuthorAvatarLink author={comment.author} className={`relative z-[1] ${avatarSize}`} />
      <div className="min-w-0 flex-1">
        <div className={`relative rounded-2xl px-3 py-2.5 ${isReply ? 'bg-mist-50/70 ring-1 ring-mist-100' : 'bg-mist-50'}`}>
          <div className="flex flex-wrap items-baseline gap-x-2 pr-7 max-md:pr-9">
            <Link href={profileHref(comment.author.slug)} className="text-sm font-semibold text-navy-950 hover:text-ocean-700 hover:underline">{comment.author.fullName}</Link>
            {isPostAuthor ? <span className="rounded-full bg-ocean-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ocean-800">Author</span> : null}
            <span className="min-w-0 truncate text-xs text-muted">{comment.author.rank ?? comment.author.headline ?? 'Maritime professional'}</span>
            <div className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted"><time dateTime={comment.createdAt}>{relativeTime(comment.createdAt)}</time>{edited ? <span>Edited</span> : null}</div>
          </div>
          {replyTarget ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted" data-testid={`reply-target-${comment.id}`}>
              <CornerDownRight aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">
                Replying to{' '}
                {replyTarget.authorSlug ? (
                  <Link href={profileHref(replyTarget.authorSlug)} className="font-semibold text-navy-900 hover:text-ocean-700 hover:underline">{replyTarget.authorName}</Link>
                ) : <span className="font-semibold text-navy-900">{replyTarget.authorName}</span>}
              </span>
            </p>
          ) : null}
          {!readOnly ? (
            <CommentActionsMenu
              owner={Boolean(comment.viewerOwns)}
              canEdit={Boolean(comment.canEdit)}
              pending={managementPending}
              onEdit={beginEdit}
              onDelete={removeComment}
              onReport={() => setReportOpen(true)}
              triggerRef={menuTriggerRef}
            />
          ) : null}
          {editing ? (
            <form className="mt-2" onSubmit={(event) => { event.preventDefault(); submitEdit(new FormData(event.currentTarget)) }}>
              <input type="hidden" name="commentId" value={comment.id} />
              <label htmlFor={`edit-comment-${comment.id}`} className="sr-only">Edit comment</label>
              <MentionInput id={`edit-comment-${comment.id}`} name="body" rows={2} value={editBody} onChange={setEditBody} mentions={editMentions} onMentionsChange={setEditMentions} textareaRef={editTextareaRef} maxLength={2000} placeholder="Edit comment…" className="min-h-16 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500" />
              <div className="mt-2 flex items-center justify-end gap-2">
                <div className="mr-auto"><EmojiPicker onSelect={insertEditEmoji} label="Add emoji to comment" size="sm" /></div>
                <button type="button" onClick={cancelEdit} disabled={managementPending} className="min-h-8 rounded-lg px-3 text-xs font-semibold text-navy-900 border border-mist-200 bg-white transition-colors hover:border-ocean-300 hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
                <button type="submit" disabled={managementPending} className="min-h-8 rounded-lg bg-navy-950 px-3 text-xs font-semibold text-white disabled:opacity-60 enabled:hover:bg-navy-800 transition-colors disabled:cursor-not-allowed">{managementPending ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          ) : <ExpandableText body={comment.body} mentions={comment.mentions} limits={COMMENT_COLLAPSE} className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink [overflow-wrap:anywhere]" />}
        </div>
        {!editing ? (
          <div data-testid={`comment-actions-${comment.id}`} className="mt-1 flex min-h-8 items-center gap-1.5 px-1">
            {!readOnly ? (
              <ReactionPicker value={reaction} disabled={reactionPending} onChange={changeReaction} count={reactionCount(summary)} variant="comment" />
            ) : null}
            {!readOnly ? (
              <>
                <span aria-hidden="true" className="text-xs text-muted">·</span>
                <button
                  type="button"
                  onClick={() => setReplying((value) => !value)}
                  aria-expanded={replying}
                  aria-label="Reply"
                  title={`Reply to ${comment.author.fullName}`}
                  className="inline-flex min-h-8 shrink-0 cursor-pointer items-center rounded-full border border-mist-200 bg-white px-2.5 text-xs font-semibold text-navy-900 transition hover:border-ocean-300 hover:bg-mist-50 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40"
                >
                  Reply
                </button>
              </>
            ) : null}
            <CommentReplySummary count={replyCount} />
            <ReactionSummaryTrigger variant="comment" className="ml-auto" summary={summary} onOpen={() => setReactionsOpen(true)} />
          </div>
        ) : null}
        {reportOpen ? (
          <ReportContentButton
            targetType="comment"
            targetId={comment.id}
            label="Report comment"
            defaultOpen
            hideTrigger
            onClose={() => {
              setReportOpen(false)
              menuTriggerRef.current?.focus()
            }}
          />
        ) : null}
        {error ? <p role="alert" className="px-1 text-xs text-red-700">{error}</p> : null}
        {replying && !readOnly && !editing ? <ReplyComposer postId={postId} target={comment} onCreated={onCreatedReply} onDone={() => setReplying(false)} /> : null}
        <ReactionDetailsModal open={reactionsOpen} targetType="comment" targetId={comment.id} summary={summary} onClose={() => setReactionsOpen(false)} />
      </div>
    </div>
  )
}

function ReplyThread({ root, replies, expanded, onToggle, children }: {
  root: FeedComment
  replies: FeedComment[]
  expanded: boolean
  onToggle(): void
  children: ReactNode
}) {
  const listId = `replies-${root.id}`
  const collapsible = replies.length >= REPLY_PREVIEW_LIMIT
  const rootName = root.deleted ? 'this comment' : root.author.fullName
  return (
    <div className="ml-[1.0625rem] border-l-2 border-mist-100 pl-3 sm:pl-4" data-testid={`reply-group-${root.id}`}>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={listId}
          className="-ml-1 mb-1 inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ocean-700 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40"
        >
          {expanded ? <ChevronUp aria-hidden="true" className="size-4" /> : <ChevronDown aria-hidden="true" className="size-4" />}
          {expanded ? 'Hide replies' : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
        </button>
      ) : null}
      {expanded || !collapsible ? (
        <div id={listId} role="group" aria-label={`Replies to ${rootName}`} className="space-y-2">
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function CommentThread({ postId, postAuthorId, comments, readOnly = false, composerOpen = false, expandReplies = false }: {
  postId: string
  postAuthorId?: string
  comments: FeedComment[]
  readOnly?: boolean
  composerOpen?: boolean
  /** Start every reply thread expanded (used on the single-post page). */
  expandReplies?: boolean
}) {
  const [canonicalComments, setCanonicalComments] = useState(comments)
  const [threadComments, setThreadComments] = useState(comments)
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<SelectedMention[]>([])
  const [visibleRootCount, setVisibleRootCount] = useState(1)
  const [expandedRoots, setExpandedRoots] = useState<Record<string, boolean>>({})
  const { textareaRef, insert } = useEmojiInsertion(body, setBody)

  if (canonicalComments !== comments) {
    setCanonicalComments(comments)
    setThreadComments(comments)
  }

  function upsertComment(nextComment: FeedComment) {
    setThreadComments((current) => {
      const exists = current.some((comment) => comment.id === nextComment.id)
      if (exists) return current.map((comment) => comment.id === nextComment.id ? nextComment : comment)
      return [...current, nextComment]
    })
  }

  function addReply(reply: FeedComment) {
    upsertComment(reply)
    const rootId = reply.parentCommentId
    if (rootId) setExpandedRoots((current) => ({ ...current, [rootId]: true }))
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
      if (!comment.parentCommentId || comment.deleted) continue
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

  function isExpanded(rootId: string, replyCount: number) {
    return expandedRoots[rootId] ?? (expandReplies || replyCount <= REPLY_PREVIEW_LIMIT)
  }

  // Nothing to show (for example the loaded comments were all removed): no empty bordered band.
  if (!visibleRoots.length && !(composerOpen && !readOnly) && !state.error) return null

  return (
    <div id={`comments-${postId}`} className="border-t border-mist-100 px-4 py-4 sm:px-5">
      {visibleRoots.length ? (
        <div className="space-y-4">
          {visibleRoots.map((comment) => {
            const replies = repliesByRoot.get(comment.id) ?? []
            const expanded = isExpanded(comment.id, replies.length)
            return (
              <div key={comment.id} className="space-y-2" data-testid={`comment-group-${comment.id}`}>
                <CommentItem postId={postId} postAuthorId={postAuthorId} comment={comment} rootComment={comment} readOnly={readOnly} replyCount={replies.length} onChanged={upsertComment} onDeleted={reconcileDelete} onCreatedReply={addReply} />
                {replies.length ? (
                  <ReplyThread
                    root={comment}
                    replies={replies}
                    expanded={expanded}
                    onToggle={() => setExpandedRoots((current) => ({ ...current, [comment.id]: !expanded }))}
                  >
                    {replies.map((reply) => <CommentItem key={reply.id} postId={postId} postAuthorId={postAuthorId} comment={reply} rootComment={comment} readOnly={readOnly} isReply onChanged={upsertComment} onDeleted={reconcileDelete} onCreatedReply={addReply} />)}
                  </ReplyThread>
                ) : null}
              </div>
            )
          })}
          {remaining > 0 ? <button type="button" onClick={() => setVisibleRootCount((count) => Math.min(roots.length, count + 10))} className="min-h-9 rounded-lg px-2 text-sm font-semibold text-ocean-700 hover:bg-mist-50">View {remaining} more comments</button> : null}
        </div>
      ) : composerOpen && !readOnly ? <p className="text-sm text-muted">Start the professional discussion.</p> : null}

      {composerOpen && !readOnly ? (
        <form action={formAction} className="mt-3 flex items-end gap-1.5">
          <input type="hidden" name="postId" value={postId} />
          <div className="min-w-0 flex-1">
            <label htmlFor={`comment-${postId}`} className="sr-only">Add a comment</label>
            <MentionInput id={`comment-${postId}`} name="body" rows={1} value={body} onChange={setBody} mentions={mentions} onMentionsChange={setMentions} textareaRef={textareaRef} maxLength={2000} placeholder="Write a comment…" className="min-h-11 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500" />
            {state.fieldErrors?.body ? <p className="mt-1 text-xs text-red-700">{state.fieldErrors.body[0]}</p> : null}
          </div>
          <EmojiPicker onSelect={insert} label="Add emoji to comment" align="right" />
          <button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:opacity-60 enabled:hover:bg-navy-800 transition-colors disabled:cursor-not-allowed">{pending ? 'Adding…' : 'Comment'}</button>
        </form>
      ) : null}
      {state.error ? <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p> : null}
    </div>
  )
}
