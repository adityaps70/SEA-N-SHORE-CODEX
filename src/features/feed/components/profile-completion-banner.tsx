'use client'

import Link from 'next/link'
import { CircleCheck, X } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'

export const PROFILE_BANNER_DISMISS_KEY = 'sea-n-shore:profile-banner-dismissed'

function readDismissal() {
  try {
    return window.localStorage.getItem(PROFILE_BANNER_DISMISS_KEY)
  } catch {
    // Storage can be blocked (private mode): the banner simply stays.
    return null
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

/**
 * Phone-only Home banner: "Complete your profile · n%" with the next missing item, linking to
 * /profile/edit. Shown only while the profile is incomplete. Dismissing hides it on this device
 * until the completion changes. On md and wider the profile card in the rail carries this instead.
 */
export function ProfileCompletionBanner({ completion, hint }: { completion: number; hint: string | null }) {
  const [dismissedNow, setDismissed] = useState(false)
  // The server render has no storage, so the banner shows until the stored dismissal is read.
  const storedDismissal = useSyncExternalStore(subscribe, readDismissal, () => null)
  const dismissed = dismissedNow || storedDismissal === String(completion)

  if (completion >= 100 || dismissed) return null

  function dismiss() {
    setDismissed(true)
    try {
      window.localStorage.setItem(PROFILE_BANNER_DISMISS_KEY, String(completion))
    } catch {
      // Dismissed for this visit only.
    }
  }

  return (
    <div
      data-testid="profile-completion-banner"
      className="relative -mx-4 -mt-4 mb-2 flex items-center gap-3 border-b border-mist-200 bg-mist-100 py-2 pl-4 pr-1 md:hidden"
    >
      <CircleCheck aria-hidden="true" className="size-6 shrink-0 text-teal-500" />
      <Link
        href="/profile/edit"
        aria-label={`Complete your profile ${completion}%${hint ? `. ${hint}` : ''}`}
        className="min-w-0 flex-1 rounded-lg py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
      >
        <span className="block truncate text-[15px] font-semibold text-ocean-800">
          Complete your profile <span aria-hidden="true">·</span> {completion}%
        </span>
        {hint ? <span className="block truncate text-[13px] text-ocean-700">{hint}</span> : null}
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss profile reminder"
        className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ocean-800 hover:bg-white/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    </div>
  )
}
