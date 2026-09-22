'use client'

import Link from 'next/link'
import { Bookmark, MessageCircle, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import { deletePost, setPostReaction, setPostSaved } from '../actions'
import {
  EMPTY_REACTION_SUMMARY,
  type FeedPost,
  type FeedRepostSource,
  type PostReactionType,
  type ReactionSummary,
} from '../types'
import { CommentThread } from './comment-thread'
import { MentionText } from './mention-text'
import { PollCard } from './poll-card'
import { PostMedia } from './post-media'
import { ReactionDetailsModal } from './reaction-details-modal'
import { ReactionPicker } from './reaction-picker'
import { ReactionSummaryTrigger } from './reaction-summary'
import { SharePostButton } from './share-post-button'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

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

function RepostSourceCard({ source }: { source: FeedRepostSource }) {
  const media = source.mediaItems?.length ? source.mediaItems : source.media ? [source.media] : []
  return (
    <section
      role="region"
      aria-label={`Original post by ${source.author.fullName}`}
      className="rounded-2xl border border-mist-100 bg-mist-50/35 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-mist-100 text-xs font-semibold text-navy-950 ring-1 ring-mist-100">
          {source.author.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={source.author.avatarUrl} alt={`${source.author.fullName}'s profile photo`} className="h-full w-full object-cover" />
          ) : initials(source.author.fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <Link href={`/people/${source.author.slug}`} className="font-semibold text-navy-950 hover:text-ocean-700">
            {source.author.fullName}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted">
            {[source.author.rank ?? source.author.headline, source.author.currentCompany].filter(Boolean).join(' · ') || 'Maritime professional'}
          </p>
          <time suppressHydrationWarning dateTime={source.createdAt} title={new Date(source.createdAt).toISOString()} className="mt-1 block text-xs text-muted">
            {relativeTime(source.createdAt)}
          </time>
        </div>
      </div>

      <p className="mt-4 break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-7 text-ink">
        <MentionText body={source.body} mentions={source.mentions} />
      </p>
      {media.some((item) => item.signedUrl) ? <PostMedia media={media} authorName={source.author.fullName} /> : null}
      <RepostSourcePoll source={source} />
      <Link href={`/posts/${source.id}`} className="mt-4 inline-flex text-sm font-semibold text-ocean-700 hover:text-ocean-800">
        View original post
      </Link>
    </section>
  )
}

export function PostCard({ post, detail = false, readOnly = false }: { post: FeedPost; detail?: boolean; readOnly?: boolean }) {
  const [canonicalPost, setCanonicalPost] = useState(post)
  const [reaction, setReaction] = useState<PostReactionType | null>(post.viewerReaction ?? (post.viewerLiked ? 'like' : null))
  const [summary, setSummary] = useState<ReactionSummary>(() => initialSummary(post))
  const [saved, setSaved] = useState(post.viewerSaved)
  const [composerOpen, setComposerOpen] = useState(detail && !readOnly)
  const [reactionsOpen, setReactionsOpen] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  if (canonicalPost !== post) {
    setCanonicalPost(post)
    setReaction(post.viewerReaction ?? (post.viewerLiked ? 'like' : null))
    setSummary(initialSummary(post))
    setSaved(post.viewerSaved)
  }

  function changeReaction(next: PostReactionType | null) {
    if (readOnly || pending) return
    const previousReaction = reaction
    const previousSummary = summary
    setReaction(next)
    setSummary(updateSummary(summary, previousReaction, next))
    setError('')
    startTransition(async () => {
      const result = await setPostReaction(post.id, next)
      if (!result.ok) {
        setReaction(previousReaction)
        setSummary(previousSummary)
        setError(result.error)
      }
    })
  }

  function changeSaved() {
    if (readOnly) return
    const next = !saved
    const previous = saved
    setSaved(next)
    setError('')
    startTransition(async () => {
      const result = await setPostSaved(post.id, next)
      if (!result.ok) {
        setSaved(previous)
        setError(result.error)
      }
    })
  }

  function removePost() {
    if (readOnly || pending || !window.confirm('Delete this post? This will remove it from the feed and your profile.')) return
    setError('')
    startTransition(async () => {
      const result = await deletePost(post.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDeleted(true)
    })
  }

  if (deleted) return null

  const isRepost = post.postType === 'repost'
  const postMedia = post.mediaItems?.length ? post.mediaItems : post.media ? [post.media] : []

  return (
    <Card className="overflow-visible border border-mist-100">
      <article aria-labelledby={`post-author-${post.id}`}>
        <header className="flex items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-mist-100 text-sm font-semibold text-navy-950 ring-1 ring-mist-100">
            {post.author.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.author.avatarUrl} alt={`${post.author.fullName}'s profile photo`} className="h-full w-full object-cover" />
            ) : initials(post.author.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Link id={`post-author-${post.id}`} href={`/people/${post.author.slug}`} className="font-semibold text-navy-950 hover:text-ocean-700">
                {post.author.fullName}
              </Link>
              {isRepost ? <span className="text-xs font-medium text-muted">reposted</span> : null}
            </div>
            <p className="mt-0.5 truncate text-sm text-muted">
              {[post.author.rank ?? post.author.headline, post.author.currentCompany].filter(Boolean).join(' · ') || 'Maritime professional'}
            </p>
            <time suppressHydrationWarning dateTime={post.createdAt} title={new Date(post.createdAt).toISOString()} className="mt-1 block text-xs text-muted">
              {relativeTime(post.createdAt)}
            </time>
          </div>
          {post.viewerOwns && !readOnly ? (
            <button type="button" disabled={pending} onClick={removePost} aria-label="Delete post" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50">
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </header>

        <div className="px-4 pb-4 pt-4 sm:px-5">
          {isRepost && post.repostOf ? (
            <RepostSourceCard source={post.repostOf} />
          ) : (
            <>
              <p className="break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-7 text-ink"><MentionText body={post.body} mentions={post.mentions} /></p>
              {postMedia.some((item) => item.signedUrl) ? <PostMedia media={postMedia} authorName={post.author.fullName} /> : null}
              {post.poll ? <PollCard postId={post.id} poll={post.poll} /> : null}
            </>
          )}
        </div>

        {readOnly ? (
          <div className="border-t border-mist-100 px-4 py-2 sm:px-5">
            <SharePostButton postId={post.id} allowRepost={false} />
          </div>
        ) : (
          <div
            role="group"
            aria-label="Post actions"
            className="flex items-center justify-between border-t border-mist-100 px-3 py-1 sm:px-4"
          >
            <div data-testid="post-primary-actions" className="flex min-w-0 items-center gap-2 sm:gap-3">
              <ReactionPicker value={reaction} disabled={pending} onChange={changeReaction} compact />
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                aria-label="Comment"
                aria-expanded={composerOpen}
                aria-controls={`comments-${post.id}`}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-navy-900 hover:bg-mist-50"
              >
                <MessageCircle aria-hidden="true" className="size-5" />
                <span>{post.commentCount}</span>
              </button>
              <SharePostButton postId={post.id} iconOnly allowRepost={!isRepost} />
              <button
                type="button"
                aria-label="Save"
                aria-pressed={saved}
                disabled={pending}
                onClick={changeSaved}
                className={`inline-flex min-h-11 items-center justify-center rounded-xl px-2 text-sm font-semibold hover:bg-mist-50 ${saved ? 'text-ocean-700' : 'text-navy-900'}`}
              >
                <Bookmark aria-hidden="true" className="size-5" fill={saved ? 'currentColor' : 'none'} />
              </button>
              {!post.viewerOwns ? (
                <ReportContentButton targetType="post" targetId={post.id} label="Report post" iconOnly />
              ) : null}
            </div>
            <div className="flex min-w-0 items-center justify-end pl-2">
              <ReactionSummaryTrigger summary={summary} onOpen={() => setReactionsOpen(true)} />
            </div>
          </div>
        )}

        {error ? <p role="alert" className="mx-4 mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 sm:mx-5">{error}</p> : null}
        {(post.commentCount > 0 || composerOpen) ? (
          <CommentThread postId={post.id} comments={post.comments} readOnly={readOnly} composerOpen={composerOpen} />
        ) : null}
        <ReactionDetailsModal
          open={reactionsOpen}
          targetType="post"
          targetId={post.id}
          summary={summary}
          onClose={() => setReactionsOpen(false)}
        />
      </article>
    </Card>
  )
}
