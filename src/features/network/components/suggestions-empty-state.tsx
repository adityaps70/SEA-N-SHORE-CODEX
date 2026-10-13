'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Search, Share2 } from 'lucide-react'

export const SUGGESTIONS_EMPTY_TITLE = 'You’ve seen everyone we can suggest for now'

/** Shares the site link (the share sheet on phones, otherwise a copied link), as profile sharing does. */
export function InviteColleaguesButton({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false)

  async function invite() {
    const url = window.location.origin
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Sea N Shore', text: 'Join me on Sea N Shore, the maritime professional network.', url })
        return
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      }
    } catch {
      // The member closed the share sheet; nothing to do.
    }
  }

  return (
    <button type="button" onClick={() => { void invite() }} className={className}>
      <Share2 aria-hidden="true" className="size-4" />
      <span aria-live="polite">{copied ? 'Link copied' : 'Invite colleagues'}</span>
    </button>
  )
}

/**
 * Round G hotfix: shown instead of repeating people once nobody eligible is left.
 * `compact` fits a rail card or the phone feed row.
 */
export function SuggestionsEmptyState({ compact = false }: { compact?: boolean }) {
  const action = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'
  return (
    <div data-testid="suggestions-empty" className={compact ? 'py-2 text-left' : 'px-6 py-10 text-center'}>
      <p data-suggestions-empty tabIndex={-1} className="font-semibold text-navy-950 outline-none">{SUGGESTIONS_EMPTY_TITLE}</p>
      <p className={`mt-1 text-sm leading-6 text-muted ${compact ? '' : 'mx-auto max-w-lg'}`}>
        New members join every week. Invite colleagues you have sailed or worked with, or search for someone you know.
      </p>
      <div className={`mt-3 flex flex-wrap gap-2 ${compact ? '' : 'justify-center'}`}>
        <InviteColleaguesButton className={`${action} bg-ocean-700 text-white hover:bg-ocean-800`} />
        <Link href="/search?type=people" className={`${action} border border-ocean-700 text-ocean-700 hover:bg-ocean-50`}>
          <Search aria-hidden="true" className="size-4" />
          Search people
        </Link>
      </div>
    </div>
  )
}
