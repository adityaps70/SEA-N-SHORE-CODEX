'use client'

import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './media'

/**
 * Cycles through `words` in place (blur/slide), like an AnimatePresence swap. Screen
 * readers get the full list once instead of a live region that talks every few seconds.
 * Without JavaScript, or with reduced motion, the first word simply stays.
 */
export function RotatingWords({
  words,
  label,
  interval = 2800,
  className = 'rot',
}: {
  words: readonly string[]
  /** What assistive technology reads instead, e.g. "seafarers, shore staff and trainers". */
  label: string
  interval?: number
  className?: string
}) {
  const [state, setState] = useState<{ index: number; previous: number | null }>({ index: 0, previous: null })

  useEffect(() => {
    if (words.length < 2 || prefersReducedMotion()) return
    const timer = window.setInterval(() => {
      setState((current) => ({ index: (current.index + 1) % words.length, previous: current.index }))
    }, interval)
    return () => window.clearInterval(timer)
  }, [words.length, interval])

  return (
    <span className={className} data-rotating-words="">
      <span className="sr-only">{label}</span>
      {words.map((word, index) => (
        <span
          key={word}
          aria-hidden="true"
          className={`rw${index === state.index ? ' on' : index === state.previous ? ' out' : ''}`}
        >
          {word}
        </span>
      ))}
    </span>
  )
}
