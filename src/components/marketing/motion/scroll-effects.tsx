'use client'

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { prefersReducedMotion } from './media'

/** Calls `onFrame(scrollY)` at most once per animation frame while the page scrolls. */
function useScrollFrame(onFrame: (scrollY: number) => void) {
  const callback = useRef(onFrame)
  useEffect(() => {
    callback.current = onFrame
  })
  useEffect(() => {
    let queued = false
    const run = () => {
      queued = false
      callback.current(window.scrollY)
    }
    const onScroll = () => {
      if (queued) return
      queued = true
      window.requestAnimationFrame(run)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    run()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
}

/** Thin bar at the top of the window that fills as the page is read. */
export function ScrollProgress({ className = 'progress' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollFrame((scrollY) => {
    const bar = ref.current
    if (!bar) return
    const scrollable = document.documentElement.scrollHeight - window.innerHeight
    bar.style.transform = `scaleX(${scrollable > 0 ? Math.min(scrollY / scrollable, 1) : 0})`
  })
  return <div ref={ref} className={className} aria-hidden="true" />
}

/** A <header> that sets data-scrolled="true" once the page moves, for a soft shadow. */
export function ScrollHeader({ children, ...rest }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false)
  useScrollFrame((scrollY) => setScrolled(scrollY > 8))
  return (
    <header {...rest} data-scrolled={scrolled ? 'true' : 'false'}>
      {children}
    </header>
  )
}

/** Moves its content down slowly as the page scrolls (depth effect on the hero photo). */
export function ScrollDrift({ factor = 0.08, until = 900, children, ...rest }: HTMLAttributes<HTMLDivElement> & { factor?: number; until?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useRef<boolean | null>(null)
  useScrollFrame((scrollY) => {
    const element = ref.current
    if (!element) return
    if (reduced.current === null) reduced.current = prefersReducedMotion()
    if (reduced.current || scrollY > until) return
    element.style.transform = `translateY(${(scrollY * factor).toFixed(1)}px)`
  })
  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  )
}
