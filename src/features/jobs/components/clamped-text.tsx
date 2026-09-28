'use client'

import { useState } from 'react'

/** Long text clamped to four lines on phones with a "…more" toggle; unchanged from md up. */
export function ClampedText({ text, className = '', threshold = 240 }: { text: string; className?: string; threshold?: number }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > threshold || text.split('\n').length > 4
  return (
    <div>
      <p className={`${className} ${long && !expanded ? 'max-md:line-clamp-4' : ''}`}>{text}</p>
      {long ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 min-h-11 cursor-pointer text-[15px] font-semibold text-muted hover:text-navy-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 md:hidden"
        >
          {expanded ? 'Show less' : '…more'}
        </button>
      ) : null}
    </div>
  )
}
