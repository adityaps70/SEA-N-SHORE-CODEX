'use client'

import { useState } from 'react'
import { Share2 } from 'lucide-react'

export function SharePostButton({ postId, iconOnly = false }: { postId: string; iconOnly?: boolean }) {
  const [message, setMessage] = useState('')

  async function share() {
    const url = new URL(`/posts/${postId}`, window.location.origin).toString()
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Sea N Shore maritime post', text: 'View this maritime discussion on Sea N Shore.', url })
        setMessage('Shared')
      } else {
        await navigator.clipboard.writeText(url)
        setMessage('Link copied')
      }
    } catch {
      setMessage('Share cancelled')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={share}
        aria-label={iconOnly ? 'Share' : undefined}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-navy-900 hover:bg-mist-50"
      >
        <Share2 aria-hidden="true" className="size-5" />
        {iconOnly ? null : 'Share'}
      </button>
      <span className="sr-only" aria-live="polite">{message}</span>
    </>
  )
}
