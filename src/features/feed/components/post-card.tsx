'use client'

import Link from 'next/link'
import { MessageCircle, X } from 'lucide-react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import { followProfile, unfollowProfile } from '@/features/network/actions'
import { deletePost, setPostHidden, setPostReaction, setPostSaved } from '../actions'
import {
  EMPTY_REACTION_SUMMARY,
  reactionCount,
  type FeedAuthor,
  type FeedMention,
  type FeedOrganization,
  type FeedPost,
  type FeedRepostSource,
  type PostReactionType,
  type ReactionSummary,
} from '../types'
import { AuthorAvatarLink, OrganizationLogoLink, publishedAsHref } from './author-avatar'
import { CommentThread } from './comment-thread'
import { EditPostDialog } from './edit-post-dialog'
import { FeedDialog } from './feed-dialog'
import { ExpandableText } from './expandable-text'
import { PollCard } from './poll-card'
import { PostActionsMenu } from './post-actions-menu'
import { POST_ACTION_BUTTON_CLASS, POST_ACTION_LABEL_CLASS } from './post-action-styles'
import { PostMedia } from './post-media'
import { ReactionDetailsModal } from './reaction-details-modal'
import { ReactionPicker } from './reaction-picker'
import { ReactionSummaryTrigger } from './reaction-summary'
import { SendPostButton } from './send-post-button'
import { SharePostButton } from './share-post-button'
import { copyToClipboard, postPermalink, type FeedNotice } from './share-utils'

function relativeTime(timestamp: string) {
  const seconds = Math.round((new Date(timestamp).getTime() - Date.now()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return 'just now'
  if (abs < 3600) return `${Math.max(1, Math.round(abs / 60))}m ago`
  if (abs < 86400) return `${Math.max(1, Math.round(abs / 3600))}h ago`
  if (abs < 604800) return `${Math.max(1, Math.round(abs / 86400))}d ago`
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(timestamp))
}

function initialSummary(post: FeedPost): ReactionSummary {
  return post.reactionSummary ?? { ...EMPTY_REACTION_SUMMARY, like: post.likeCount }
}

function updateSummary(summary: ReactionSummary, previous: PostReactionType | null, next: PostReactionType | null) {
  const updated = { ...summary }
  if (previous) updated[previous] = Math.max(0, updated[previous] - 1)
  if (next) updated[next] += 1
  return updated
}

function RepostSourcePoll({ source }: { source: FeedRepostSource }) {
  if (!source.poll) return null
  const totalVotes = source.poll.options.reduce((total, option) => total + option.voteCount, 0)
  return (
    <div className="mt-4 rounded-2xl border border-mist-100 bg-mist-50/60 p-4" aria-label="Original post poll">
      <p className="text-sm font-semibold text-navy-950">Technical poll</p>
      <div className="mt-2 space-y-2">
        {source.poll.options.map((option) => {
          const percentage = totalVotes ? Math.round((option.voteCount / totalVotes) * 100) : 0
          return (
            <div key={option.id} className="flex min-h-10 items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm text-navy-900">
              <span className="font-medium">{option.label}</span>
              <span className="shrink-0 text-xs font-semibold text-muted">{percentage}% · {option.voteCount}</span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-muted">{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'} · Open the original post to vote.</p>
    </div>
  )
}

function authorContext(author: FeedAuthor) {
  return [author.rank ?? author.headline, author.currentCompany].filter(Boolean).join(' · ') || 'Maritime professional'
}

/** The name a post is shown under: its organization, or the person who wrote it. */
function publishedAsName(post: { author: FeedAuthor; organization?: FeedOrganization | null }) {
  return post.organization?.name ?? post.author.fullName
}

function RepostSourceCard({ source, expanded = false }: { source: FeedRepostSource; expanded?: boolean }) {
  const media = source.mediaItems?.length ? source.mediaItems : source.media ? [source.media] : []
  const organization = source.organization ?? null
  const name = publishedAsName(source)
  return (
    <section
      role="region"
      aria-label={`Original post by ${name}`}
      className="rounded-2xl border border-mist-100 bg-mist-50/35 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        {organization
          ? <OrganizationLogoLink organization={organization} className="size-10 rounded-xl" />
          : <AuthorAvatarLink author={source.author} className="size-10 rounded-xl text-xs" />}
        <div className="min-w-0 flex-1">
          <Link href={publishedAsHref(source)} className="font-semibold text-navy-950 hover:text-ocean-700 hover:underline">
            {name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted">
            {organization ? 'Organization' : authorContext(source.author)}
          </p>
          <time suppressHydrationWarning dateTime={source.createdAt} title={new Date(source.createdAt).toISOString()} className="mt-1 block text-xs text-muted">
            {relativeTime(source.createdAt)}
          </time>
        </div>
      </div>

      <ExpandableText
        body={source.body}
        mentions={source.mentions}
        defaultExpanded={expanded}
        className="mt-4 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-7 text-ink"
      />
      {media.some((item) => item.signedUrl) ? <PostMedia media={media} authorName={source.author.fullName} /> : null}
      <RepostSourcePoll source={source} />
      <Link href={`/posts/${source.id}`} className="mt-4 inline-flex text-sm font-semibold text-ocean-700 hover:text-ocean-800">
        View original post
      </Link>
    </section>
  )
}

function PostNotice({ notice, onDismiss }: { notice: FeedNotice; onDismiss(): void }) {
  const error = notice.tone === 'error'
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`mx-4 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-sm sm:mx-5 ${error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-900'}`}
    >
      <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{notice.text}</span>
      {notice.href ? (
        <Link href={notice.href} className="font-semibold underline underline-offset-2 hover:no-underline">{notice.hrefLabel ?? 'Open'}</Link>
      ) : null}
      {notice.action ? (
        <button type="button" onClick={notice.action.onClick} className="font-semibold underline underline-offset-2 hover:no-underline">
          {notice.action.label}
        </button>
      ) : null}
      <button type="button" onClick={onDismiss} aria-label="Dismiss message" className="-mr-1 grid size-7 place-items-center rounded-full hover:bg-white/60">
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}

export function PostCard({ post, detail = false, readOnly = false }: { post: FeedPost; detail?: boolean; readOnly?: boolean }) {
  const [canonicalPost, setCanonicalPost] = useState(post)
  const [reaction, setReaction] = useState<PostReactionType | null>(post.viewerReaction ?? (post.viewerLiked ? 'like' : null))
  const [summary, setSummary] = useState<ReactionSummary>(() => initialSummary(post))
  const [saved, setSaved] = useState(post.viewerSaved)
  const [following, setFollowing] = useState(Boolean(post.viewerFollowsAuthor))
  const [composerOpen, setComposerOpen] = useState(detail && !readOnly)
  const [reactionsOpen, setReactionsOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleted, setDeleted] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [edited, setEdited] = useState<{ body: string; mentions: FeedMention[] } | null>(null)
  const [notice, setNotice] = useState<FeedNotice | null>(null)
  const [pending, startTransition] = useTransition()
  const [visibilityPending, startVisibilityTransition] = useTransition()
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)

  if (canonicalPost !== post) {
    setCanonicalPost(post)
    setReaction(post.viewerReaction ?? (post.viewerLiked ? 'like' : null))
    setSummary(initialSummary(post))
    setSaved(post.viewerSaved)
    setFollowing(Boolean(post.viewerFollowsAuthor))
    setEdited(null)
  }

  useEffect(() => {
    if (!notice || notice.tone === 'error') return
    const timer = window.setTimeout(() => setNotice(null), notice.action ? 10_000 : 6_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  function changeReaction(next: PostReactionType | null) {
    if (readOnly || pending) return
    const previousReaction = reaction
    const previousSummary = summary
    setReaction(next)
    setSummary(updateSummary(summary, previousReaction, next))
    setNotice(null)
    startTransition(async () => {
      const result = await setPostReaction(post.id, next)
      if (!result.ok) {
        setReaction(previousReaction)
        setSummary(previousSummary)
        setNotice({ text: result.error, tone: 'error' })
      }
    })
  }

  function changeSaved() {
    if (readOnly) return
    const next = !saved
    const previous = saved
    setSaved(next)
    setNotice(null)
    startTransition(async () => {
      const result = await setPostSaved(post.id, next)
      if (!result.ok) {
        setSaved(previous)
        setNotice({ text: result.error, tone: 'error' })
        return
      }
      setNotice(next
        ? { text: 'Post saved.', tone: 'success', href: '/saved', hrefLabel: 'View saved posts' }
        : { text: 'Removed from your saved posts.', tone: 'success' })
    })
  }

  async function copyLink() {
    const url = postPermalink(post.id)
    const copied = await copyToClipboard(url)
    setNotice(copied
      ? { text: 'Link copied. Paste it anywhere to share this post.', tone: 'success' }
      : { text: `We could not copy automatically. Copy this link instead: ${url}`, tone: 'error' })
  }

  function changeHidden(next: boolean) {
    if (readOnly || visibilityPending) return
    setNotice(null)
    startVisibilityTransition(async () => {
      const result = await setPostHidden(post.id, next)
      if (!result.ok) {
        setNotice({ text: result.error, tone: 'error' })
        return
      }
      setHidden(next)
      if (!next) setNotice({ text: 'Post restored to your feed.', tone: 'success' })
    })
  }

  function changeFollowing(next: boolean) {
    if (readOnly || pending) return
    setNotice(null)
    startTransition(async () => {
      const result = next ? await followProfile(post.author.id) : await unfollowProfile(post.author.id)
      if (!result.ok) {
        setNotice({ text: result.error, tone: 'error' })
        return
      }
      setFollowing(next)
      setNotice(next
        ? { text: `You are following ${post.author.fullName} again.`, tone: 'success' }
        : {
          text: `You unfollowed ${post.author.fullName}.`,
          tone: 'success',
          action: { label: 'Undo', onClick: () => changeFollowing(true) },
        })
    })
  }

  function removePost() {
    if (readOnly || pending) return
    setDeleteError('')
    startTransition(async () => {
      const result = await deletePost(post.id)
      if (!result.ok) {
        setDeleteError(`${result.error} Please try again.`)
        return
      }
      setConfirmDelete(false)
      setDeleted(true)
    })
  }

  if (deleted) {
    return (
      <Card className="border border-mist-100">
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-4 text-sm text-navy-900 sm:px-5">
          <span className="font-semibold">Post deleted.</span>
          {post.viewerOwns ? (
            <>
              <span className="text-muted">You can restore it for 30 days.</span>
              <Link href="/activities?tab=deleted" className="font-semibold text-ocean-700 hover:text-ocean-800 hover:underline">Recently deleted</Link>
            </>
          ) : (
            <span className="text-muted">It no longer appears in the feed or on the organization page.</span>
          )}
        </div>
      </Card>
    )
  }

  if (hidden) {
    return (
      <Card className="border border-mist-100">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div role="status" className="min-w-0">
            <p className="text-sm font-semibold text-navy-950">Post hidden</p>
            <p className="mt-0.5 text-sm text-muted">You won&apos;t see this post from {publishedAsName(post)} in your feed.</p>
          </div>
          <button
            type="button"
            onClick={() => changeHidden(false)}
            disabled={visibilityPending}
            className="min-h-10 rounded-xl border border-mist-200 px-4 text-sm font-semibold text-navy-950 hover:border-ocean-300 hover:bg-mist-50 disabled:opacity-60"
          >
            {visibilityPending ? 'Restoring…' : 'Undo'}
          </button>
        </div>
        {notice?.tone === 'error' ? <PostNotice notice={notice} onDismiss={() => setNotice(null)} /> : null}
      </Card>
    )
  }

  const isRepost = post.postType === 'repost'
  const isOwner = Boolean(post.viewerOwns)
  const canEdit = post.viewerCanEdit ?? isOwner
  const canDelete = post.viewerCanDelete ?? isOwner
  const organization = post.organization ?? null
  const displayName = publishedAsName(post)
  const body = edited?.body ?? post.body
  const mentions = edited?.mentions ?? post.mentions
  const postMedia = post.mediaItems?.length ? post.mediaItems : post.media ? [post.media] : []
  const repostCommentary = isRepost ? body.trim() : ''
  const shareSource = isRepost && post.repostOf
    ? { id: post.repostOf.id, authorName: publishedAsName(post.repostOf), body: post.repostOf.body }
    : { id: post.id, authorName: displayName, body }
  const canRepost = !isRepost || Boolean(post.repostOf)
  const totalReactions = reactionCount(summary)

  return (
    <Card className="overflow-visible border border-mist-100">
      <article aria-labelledby={`post-author-${post.id}`}>
        <header className="flex items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          {organization
            ? <OrganizationLogoLink organization={organization} className="size-11 rounded-xl" />
            : <AuthorAvatarLink author={post.author} className="size-11 rounded-2xl text-sm" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Link
                id={`post-author-${post.id}`}
                href={publishedAsHref(post)}
                className="font-semibold text-navy-950 hover:text-ocean-700 hover:underline"
              >
                {displayName}
              </Link>
              {isRepost ? <span className="text-xs font-medium text-muted">{repostCommentary ? 'reposted with thoughts' : 'reposted'}</span> : null}
            </div>
            <p className="mt-0.5 truncate text-sm text-muted">
              {organization
                ? (canEdit || canDelete) && !isOwner
                  ? `Organization · Posted by ${post.author.fullName}`
                  : isOwner ? 'Organization · Posted by you' : 'Organization'
                : authorContext(post.author)}
            </p>
            <time suppressHydrationWarning dateTime={post.createdAt} title={new Date(post.createdAt).toISOString()} className="mt-1 block text-xs text-muted">
              {relativeTime(post.createdAt)}
            </time>
          </div>
          {!readOnly ? (
            <PostActionsMenu
              authorName={displayName}
              isOwner={isOwner}
              canEdit={canEdit}
              canDelete={canDelete}
              saved={saved}
              // Following is about people; organization posts are followed through the organization.
              canUnfollow={!isOwner && !organization && following}
              pending={pending || visibilityPending}
              onToggleSave={changeSaved}
              onCopyLink={() => { void copyLink() }}
              onHide={() => changeHidden(true)}
              onUnfollow={() => changeFollowing(false)}
              onReport={() => setReportOpen(true)}
              onDelete={() => { setDeleteError(''); setConfirmDelete(true) }}
              onEdit={() => setEditOpen(true)}
              triggerRef={menuTriggerRef}
            />
          ) : null}
        </header>

        <div className="px-4 pb-4 pt-4 sm:px-5">
          {isRepost && post.repostOf ? (
            <>
              {repostCommentary ? (
                <ExpandableText
                  body={repostCommentary}
                  mentions={mentions}
                  defaultExpanded={detail}
                  className="mb-3 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-7 text-ink"
                />
              ) : null}
              <RepostSourceCard source={post.repostOf} expanded={detail} />
            </>
          ) : (
            <>
              <ExpandableText
                body={body}
                mentions={mentions}
                defaultExpanded={detail}
                className="break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-7 text-ink"
              />
              {postMedia.some((item) => item.signedUrl) ? <PostMedia media={postMedia} authorName={displayName} /> : null}
              {post.poll ? <PollCard postId={post.id} poll={post.poll} /> : null}
            </>
          )}
        </div>

        {readOnly ? (
          <div className="flex items-center justify-between gap-2 border-t border-mist-100 px-4 py-2 sm:px-5">
            <SharePostButton postId={post.id} authorName={displayName} allowRepost={false} allowSend={false} menuAlign="start" />
            <ReactionSummaryTrigger summary={summary} onOpen={() => setReactionsOpen(true)} />
          </div>
        ) : (
          <div
            role="group"
            aria-label="Post actions"
            className="@container flex items-center justify-between gap-2 border-t border-mist-100 px-3 py-2 sm:px-4"
          >
            <div data-testid="post-primary-actions" className="flex min-w-0 items-center gap-1.5 @min-[26rem]:gap-2">
              <ReactionPicker value={reaction} disabled={pending} onChange={changeReaction} count={totalReactions} variant="post" />
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                aria-label="Comment"
                aria-expanded={composerOpen}
                aria-controls={`comments-${post.id}`}
                title="Comment"
                className={POST_ACTION_BUTTON_CLASS}
              >
                <MessageCircle aria-hidden="true" className="size-5" />
                <span className={POST_ACTION_LABEL_CLASS}>Comment</span>
                {post.commentCount > 0 ? <span data-testid="comment-count" aria-hidden="true" className="tabular-nums">{post.commentCount}</span> : null}
              </button>
              <SharePostButton
                postId={post.id}
                repostPostId={shareSource.id}
                authorName={shareSource.authorName}
                source={{ authorName: shareSource.authorName, body: shareSource.body }}
                variant="action"
                allowRepost={canRepost}
                menuAlign="start"
                onNotice={setNotice}
              />
              <SendPostButton postId={post.id} authorName={displayName} onNotice={setNotice} variant="action" />
            </div>
            <ReactionSummaryTrigger summary={summary} onOpen={() => setReactionsOpen(true)} />
          </div>
        )}

        {notice ? <PostNotice notice={notice} onDismiss={() => setNotice(null)} /> : null}
        {(post.commentCount > 0 || composerOpen) ? (
          <CommentThread
            postId={post.id}
            postAuthorId={post.author.id}
            comments={post.comments}
            readOnly={readOnly}
            composerOpen={composerOpen}
            expandReplies={detail}
          />
        ) : null}
        <ReactionDetailsModal
          open={reactionsOpen}
          targetType="post"
          targetId={post.id}
          summary={summary}
          onClose={() => setReactionsOpen(false)}
        />
        {reportOpen ? (
          <ReportContentButton
            targetType="post"
            targetId={post.id}
            label="Report post"
            defaultOpen
            hideTrigger
            onClose={() => {
              setReportOpen(false)
              menuTriggerRef.current?.focus()
            }}
          />
        ) : null}
        {editOpen ? (
          <EditPostDialog
            postId={post.id}
            postType={post.postType}
            body={body}
            mentions={mentions ?? []}
            publishedAs={displayName}
            onClose={() => setEditOpen(false)}
            onSaved={(savedPost) => {
              setEdited({ body: savedPost.body, mentions: savedPost.mentions ?? [] })
              setNotice({ text: 'Your changes are saved.', tone: 'success' })
            }}
            returnFocusRef={menuTriggerRef}
          />
        ) : null}
        {confirmDelete ? (
          <FeedDialog
            role="alertdialog"
            size="sm"
            title="Delete this post?"
            description={isOwner
              ? organization
                ? `It will be removed from the feed and from ${organization.name}'s page. You can restore it from My Activities › Recently deleted for 30 days.`
                : 'It will be removed from the feed and your profile. You can restore it from My Activities › Recently deleted for 30 days.'
              : `It will be removed from the feed and from ${organization?.name ?? 'the organization'}'s page for everyone, including ${post.author.fullName}, who wrote it.`}
            onClose={() => { if (!pending) setConfirmDelete(false) }}
            closeLabel="Keep post"
            returnFocusRef={menuTriggerRef}
            initialFocusSelector="[data-autofocus]"
          >
            {deleteError ? <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{deleteError}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" data-autofocus onClick={() => setConfirmDelete(false)} disabled={pending} className="min-h-10 rounded-xl border border-mist-200 px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50 disabled:opacity-60">
                Cancel
              </button>
              <button type="button" onClick={removePost} disabled={pending} className="min-h-10 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
                {pending ? 'Deleting…' : 'Delete post'}
              </button>
            </div>
          </FeedDialog>
        ) : null}
      </article>
    </Card>
  )
}
