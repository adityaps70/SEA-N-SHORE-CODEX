'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { hasFinePointer, prefersReducedMotion } from './media'

const MAGNETIC_SELECTOR = '.btn,.sbtn'

/**
 * Wraps the page and drives the scroll reveals (<Reveal>) and the gentle "magnetic" pull
 * on buttons. Until this has hydrated nothing is hidden; afterwards only elements that
 * are still off screen wait for their reveal.
 */
export function MotionRoot({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    if (prefersReducedMotion() || typeof window.IntersectionObserver !== 'function') {
      root.dataset.motion = 'off'
      return
    }

    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    const viewportHeight = window.innerHeight
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    for (const target of targets) {
      const rect = target.getBoundingClientRect()
      // Already visible: never hide it (that would flash).
      if (rect.bottom > 0 && rect.top < viewportHeight) target.classList.add('is-seen')
      else observer.observe(target)
    }
    root.dataset.motion = 'on'

    let magnet: HTMLElement | null = null
    const release = () => {
      if (magnet) magnet.style.translate = ''
      magnet = null
    }
    const onPointerMove = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(MAGNETIC_SELECTOR) : null
      if (magnet && magnet !== target) release()
      if (!target) return
      magnet = target
      const rect = target.getBoundingClientRect()
      const x = (event.clientX - rect.left - rect.width / 2) * 0.12
      const y = (event.clientY - rect.top - rect.height / 2) * 0.18
      target.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`
    }
    const magnetic = hasFinePointer()
    if (magnetic) {
      root.addEventListener('pointermove', onPointerMove, { passive: true })
      root.addEventListener('pointerleave', release)
    }

    return () => {
      observer.disconnect()
      if (magnetic) {
        root.removeEventListener('pointermove', onPointerMove)
        root.removeEventListener('pointerleave', release)
      }
      release()
    }
  }, [])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
