'use client'

import { Check, Link2, Share2 } from 'lucide-react'
import { useState } from 'react'

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function EventShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)

  async function copyEventLink() {
    await copyText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  async function shareEvent() {
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: `Join me at ${title} on Sea N Shore.`,
          url: window.location.href,
        })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }

    await copyEventLink()
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <button
        type="button"
        onClick={shareEvent}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-3 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50"
      >
        <Share2 className="h-4 w-4 text-teal-700" aria-hidden="true" />
        Share event
      </button>
      <button
        type="button"
        onClick={copyEventLink}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-3 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : <Link2 className="h-4 w-4 text-teal-700" aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy event link'}
      </button>
    </div>
  )
}
