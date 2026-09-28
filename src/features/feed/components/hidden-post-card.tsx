'use client'

import { Eye, Play } from 'lucide-react'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { unhidePost } from '../actions'
import type { HiddenPost } from '../types'
import { AuthorAvatarLink, OrganizationLogoLink, publishedAsHref } from './author-avatar'

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

/** Compact preview of a post the member hid, with an Unhide button. */
export function HiddenPostCard({ post }: { post: HiddenPost }) {
  const [pending, startTransition] = useTransition()
  const [restored, setRestored] = useState(false)
  const [error, setError] = useState('')
  const name = post.organization?.name ?? post.author.fullName
  const preview = post.body.trim()

  function unhide() {
    if (pending) return
    setError('')
    startTransition(async () => {
      const result = await unhidePost(post.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setRestored(true)
    })
  }

  if (restored) {
    return (
      <article aria-label={`Post by ${name}`} className="rounded-2xl border border-mist-100 bg-white px-4 py-4 shadow-[var(--shadow-card)] sm:px-5">
        <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-navy-900">
          <span className="font-semibold">This post is back in your feed.</span>
          <Link href={`/posts/${post.id}`} className="font-semibold text-ocean-700 hover:text-ocean-800 hover:underline">View post</Link>
        </p>
      </article>
    )
  }

  return (
    <article aria-label={`Post by ${name}`} className="rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex items-start gap-3">
        {post.organization
          ? <OrganizationLogoLink organization={post.organization} className="size-10 rounded-xl" />
          : <AuthorAvatarLink author={post.author} className="size-10 rounded-xl text-xs" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link href={publishedAsHref(post)} className="font-semibold text-navy-950 hover:text-ocean-700 hover:underline">{name}</Link>
            {post.isRepost ? <span className="text-xs font-medium text-muted">repost</span> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Posted <time dateTime={post.createdAt}>{dateLabel(post.createdAt)}</time>
            {' · '}Hidden <time dateTime={post.hiddenAt}>{dateLabel(post.hiddenAt)}</time>
          </p>
          {preview ? (
            <p className="mt-2 line-clamp-3 whitespace-pre-line break-words text-sm leading-6 text-ink [overflow-wrap:anywhere]">{preview}</p>
          ) : null}
        </div>
        {post.thumbnail ? (
          <Link
            href={`/posts/${post.id}`}
            aria-label={`Open the post by ${name}`}
            className="relative block size-16 shrink-0 overflow-hidden rounded-xl bg-mist-100 ring-1 ring-mist-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/50 sm:size-20"
          >
            {post.thumbnail.mimeType.startsWith('video/') ? (
              <>
                <video src={post.thumbnail.url} preload="metadata" muted playsInline aria-hidden="true" className="h-full w-full object-cover" />
                <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-navy-950/25 text-white"><Play className="size-5 fill-current" /></span>
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- first-party feed media route
              <img src={post.thumbnail.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            )}
          </Link>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={unhide}
          disabled={pending}
          className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition hover:border-ocean-300 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40 disabled:cursor-wait disabled:opacity-60"
        >
          <Eye aria-hidden="true" className="size-4" />
          {pending ? 'Unhiding…' : 'Unhide'}
        </button>
        <Link href={`/posts/${post.id}`} className="text-sm font-semibold text-ocean-700 hover:text-ocean-800 hover:underline">View post</Link>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    </article>
  )
}
