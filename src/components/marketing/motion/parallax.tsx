'use client'

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { hasFinePointer, prefersReducedMotion } from './media'

/**
 * Pointer-move parallax: every <ParallaxLayer> inside drifts against the pointer by its
 * `depth` in pixels, eased like a soft spring. Mouse/trackpad only; off for reduced motion.
 */
export function Parallax({ children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root || prefersReducedMotion() || !hasFinePointer()) return
    const layers = Array.from(root.querySelectorAll<HTMLElement>('[data-depth]'))
    if (!layers.length) return

    let targetX = 0
    let targetY = 0
    let x = 0
    let y = 0
    let frame = 0

    const step = () => {
      x += (targetX - x) * 0.08
      y += (targetY - y) * 0.08
      for (const layer of layers) {
        const depth = Number(layer.dataset.depth) || 0
        layer.style.translate = `${(-x * depth).toFixed(2)}px ${(-y * depth).toFixed(2)}px`
      }
      const settled = Math.abs(targetX - x) < 0.001 && Math.abs(targetY - y) < 0.001
      frame = settled ? 0 : window.requestAnimationFrame(step)
    }
    const wake = () => {
      if (!frame) frame = window.requestAnimationFrame(step)
    }
    const onMove = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      targetX = (event.clientX - rect.left) / rect.width - 0.5
      targetY = (event.clientY - rect.top) / rect.height - 0.5
      wake()
    }
    const onLeave = () => {
      targetX = 0
      targetY = 0
      wake()
    }

    root.addEventListener('pointermove', onMove, { passive: true })
    root.addEventListener('pointerleave', onLeave)
    return () => {
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerleave', onLeave)
      if (frame) window.cancelAnimationFrame(frame)
      for (const layer of layers) layer.style.translate = ''
    }
  }, [])

  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  )
}

/** A layer that moves with <Parallax>. Larger depth = moves more (feels closer). */
export function ParallaxLayer({ depth, children, ...rest }: HTMLAttributes<HTMLDivElement> & { depth: number; children: ReactNode }) {
  return (
    <div {...rest} data-depth={depth}>
      {children}
    </div>
  )
}
