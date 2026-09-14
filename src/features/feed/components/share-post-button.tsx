'use client'

import { useState, useTransition } from 'react'
import { Link2, Repeat2, Share2 } from 'lucide-react'
import { repostPost } from '../actions'

export function SharePostButton({
  postId,
  iconOnly = false,
  allowRepost = true,
}: {
  postId: string
  iconOnly?: boolean
  allowRepost?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()

  function postUrl() {
    return new URL(`/posts/${postId}`, window.location.origin).toString()
  }

  function repost() {
    if (!allowRepost || pending) return
    setMessage('')
    startTransition(async () => {
      const result = await repostPost(postId)
      setOpen(false)
      setMessage(result.ok ? 'Reposted to your feed' : result.error)
    })
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(postUrl())
      setMessage('Link copied')
      setOpen(false)
    } catch {
      setMessage('Could not copy link')
    }
  }

  async function shareExternally() {
    try {
      if (!navigator.share) {
        await copyLink()
        return
      }
      await navigator.share({
        title: 'Sea N Shore maritime post',
        text: 'View this maritime discussion on Sea N Shore.',
        url: postUrl(),
      })
      setMessage('Shared')
      setOpen(false)
    } catch {
      setMessage('Share cancelled')
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={iconOnly ? 'Share' : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-navy-900 hover:bg-mist-50"
      >
        <Share2 aria-hidden="true" className="size-5" />
        {iconOnly ? null : 'Share'}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Share post"
          className="absolute bottom-full right-0 z-50 mb-2 w-52 overflow-hidden rounded-2xl border border-mist-100 bg-white p-1.5 shadow-xl"
        >
          {allowRepost ? (
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={repost}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-navy-950 hover:bg-mist-50 disabled:opacity-50"
            >
              <Repeat2 aria-hidden="true" className="size-4" />
              {pending ? 'Reposting…' : 'Repost to feed'}
            </button>
          ) : null}
          {typeof navigator !== 'undefined' && navigator.share ? (
            <button
              type="button"
              role="menuitem"
              onClick={shareExternally}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-navy-950 hover:bg-mist-50"
            >
              <Share2 aria-hidden="true" className="size-4" />
              Share externally
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={copyLink}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-navy-950 hover:bg-mist-50"
          >
            <Link2 aria-hidden="true" className="size-4" />
            Copy link
          </button>
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">{message}</span>
    </div>
  )
}
