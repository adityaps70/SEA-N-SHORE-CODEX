'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Learning round E (E5): an article lesson with its reading time and a thin reading-progress bar that
 * stays at the top of the screen while the article scrolls past.
 */
export function ArticleReader({ minutes, children }: { minutes: number; children: ReactNode }) {
  const articleRef = useRef<HTMLDivElement | null>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let frame = 0
    function measure() {
      frame = 0
      const element = articleRef.current
      if (!element) return
      const box = element.getBoundingClientRect()
      const scrollable = box.height - window.innerHeight * 0.6
      const read = scrollable <= 0 ? (box.top < window.innerHeight ? 1 : 0) : (window.innerHeight * 0.4 - box.top) / scrollable
      setProgress(Math.min(1, Math.max(0, read)))
    }
    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  const percent = Math.round(progress * 100)
  return (
    <div>
      <div className="sticky top-18 z-10 -mx-6 mb-4 bg-white/95 px-6 pb-2 pt-1 backdrop-blur sm:-mx-8 sm:px-8 max-md:top-14 group-data-[focus=on]/player:top-0">
        <p className="text-meta text-muted">≈ {minutes} min read</p>
        <div
          role="progressbar"
          aria-label="Reading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-mist-100"
        >
          <div className="h-full rounded-full bg-ocean-600" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div ref={articleRef}>{children}</div>
    </div>
  )
}
