'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Bookmark, Heart, MessageCircle } from 'lucide-react'
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/card'
import { setPostLiked, setPostSaved } from '../actions'
import { POST_CATEGORY_LABELS, type FeedPost } from '../types'
import { CommentThread } from './comment-thread'
import { PollCard } from './poll-card'
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

export function PostCard({ post, detail = false }: { post: FeedPost; detail?: boolean }) {
  const [liked, setLiked] = useState(post.viewerLiked)
  const [saved, setSaved] = useState(post.viewerSaved)
  const [likeCount, setLikeCount] = useState(post.likeCount)
  const [commentsOpen, setCommentsOpen] = useState(detail)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function changeLike() {
    const next = !liked
    const previousLiked = liked
    const previousCount = likeCount
    setLiked(next)
    setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)))
    setError('')
    startTransition(async () => {
      const result = await setPostLiked(post.id, next)
      if (!result.ok) {
        setLiked(previousLiked)
        setLikeCount(previousCount)
        setError(result.error)
      }
    })
  }

  function changeSaved() {
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

  return (
    <Card className="overflow-hidden border border-mist-100">
      <article aria-labelledby={`post-author-${post.id}`}>
        <header className="flex items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-mist-100 text-sm font-semibold text-navy-950 ring-1 ring-mist-100">
            {initials(post.author.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link id={`post-author-${post.id}`} href={`/people/${post.author.slug}`} className="font-semibold text-navy-950 hover:text-ocean-700">
                {post.author.fullName}
              </Link>
              <span className="rounded-full bg-mist-50 px-2 py-1 text-[11px] font-semibold text-ocean-700">
                {POST_CATEGORY_LABELS[post.category]}
              </span>
            </div>
            <p className="mt-0.5 truncate text-sm text-muted">
              {[post.author.rank ?? post.author.headline, post.author.currentCompany].filter(Boolean).join(' · ') || 'Maritime professional'}
            </p>
            <time suppressHydrationWarning dateTime={post.createdAt} title={new Date(post.createdAt).toISOString()} className="mt-1 block text-xs text-muted">
              {relativeTime(post.createdAt)}
            </time>
          </div>
        </header>

        <div className="px-4 pb-4 pt-4 sm:px-5">
          <p className="whitespace-pre-wrap text-[15px] leading-7 text-ink">{post.body}</p>

          {post.media?.signedUrl ? (
            <div className="relative mt-4 aspect-[16/9] overflow-hidden rounded-2xl border border-mist-100 bg-mist-50">
              <Image
                src={post.media.signedUrl}
                alt={post.media.altText ?? `Image attached to ${post.author.fullName}'s post`}
                fill
                sizes="(max-width: 768px) 100vw, 720px"
                className="object-cover"
              />
            </div>
          ) : null}

          {post.poll ? <PollCard postId={post.id} poll={post.poll} /> : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-mist-100 px-4 py-2 text-xs text-muted sm:px-5">
          <span>{likeCount} {likeCount === 1 ? 'like' : 'likes'}</span>
          <button type="button" onClick={() => setCommentsOpen(true)} className="min-h-9 rounded-lg px-2 hover:bg-mist-50 hover:text-navy-900">
            {post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}
          </button>
        </div>

        <div className="grid grid-cols-4 border-t border-mist-100 px-2 py-1 sm:px-3">
          <button
            type="button"
            aria-pressed={liked}
            disabled={pending}
            onClick={changeLike}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold hover:bg-mist-50 ${liked ? 'text-ocean-700' : 'text-navy-900'}`}
          >
            <Heart aria-hidden="true" className="size-5" fill={liked ? 'currentColor' : 'none'} />
            <span className="hidden sm:inline">Like</span>
          </button>
          <button
            type="button"
            onClick={() => setCommentsOpen((value) => !value)}
            aria-expanded={commentsOpen}
            aria-controls={`comments-${post.id}`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold text-navy-900 hover:bg-mist-50"
          >
            <MessageCircle aria-hidden="true" className="size-5" />
            <span className="hidden sm:inline">Comment</span>
          </button>
          <SharePostButton postId={post.id} />
          <button
            type="button"
            aria-pressed={saved}
            disabled={pending}
            onClick={changeSaved}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold hover:bg-mist-50 ${saved ? 'text-ocean-700' : 'text-navy-900'}`}
          >
            <Bookmark aria-hidden="true" className="size-5" fill={saved ? 'currentColor' : 'none'} />
            <span className="hidden sm:inline">Save</span>
          </button>
        </div>

        {error ? <p role="alert" className="mx-4 mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 sm:mx-5">{error}</p> : null}
        {commentsOpen ? <CommentThread postId={post.id} comments={post.comments} /> : null}
      </article>
    </Card>
  )
}
