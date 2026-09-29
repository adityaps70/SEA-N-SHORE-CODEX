'use client'

import { useState } from 'react'

/** Phone "About" text on an event page: four lines, then "…more" to show the rest. */
export function EventAboutText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 220 || text.split('\n').length > 4
  return (
    <div>
      <p className={`whitespace-pre-wrap text-[15px] leading-6 text-ink ${expanded || !long ? '' : 'line-clamp-4'}`}>{text}</p>
      {long && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 min-h-11 cursor-pointer text-[15px] font-semibold text-navy-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
        >
          …more<span className="sr-only"> about this event</span>
        </button>
      ) : null}
    </div>
  )
}
