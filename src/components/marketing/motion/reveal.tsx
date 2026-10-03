import { createElement, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from 'react'

type MotionElementProps = HTMLAttributes<HTMLElement> & {
  /** Element to render. Defaults to a div. */
  as?: ElementType
  /** Position in a staggered group (0, 1, 2 …); later items start a little later. */
  delay?: number
  children?: ReactNode
  /** Passed through for `as="a"`. */
  href?: string
}

export type EnterVariant = 'up' | 'scale' | 'pop'

function withVar(style: CSSProperties | undefined, name: '--d' | '--i', value: number) {
  return { ...style, [name]: value } as CSSProperties
}

/**
 * Plays once when the page loads: fade + blur-up (`up`), a clipped zoom (`scale`) or a
 * springy pop (`pop`). Pure CSS, so it also runs from server-rendered HTML.
 */
export function Enter({ as = 'div', variant = 'up', delay = 0, style, ...rest }: MotionElementProps & { variant?: EnterVariant }) {
  return createElement(as, { ...rest, 'data-enter': variant, style: withVar(style, '--d', delay) })
}

/**
 * Rises into view the first time it scrolls on screen. Needs a <MotionRoot> ancestor;
 * without one (or without IntersectionObserver) the content simply stays visible.
 */
export function Reveal({ as = 'div', delay = 0, style, ...rest }: MotionElementProps) {
  return createElement(as, { ...rest, 'data-reveal': '', style: withVar(style, '--i', Math.min(Math.max(delay, 0), 8)) })
}
