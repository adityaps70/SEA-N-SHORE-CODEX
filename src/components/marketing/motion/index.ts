/**
 * Sea N Shore marketing motion layer — a small, in-house stand-in for Framer Motion.
 *
 * `motion` / `framer-motion` cannot be installed in this project right now, so every
 * animation on the public landing page goes through the components exported here and
 * nowhere else. To move to framer-motion later, re-implement these exports on top of
 * `motion.*` (e.g. Reveal -> motion.div with whileInView, Enter -> initial/animate,
 * RotatingWords -> AnimatePresence) and nothing outside this folder has to change.
 *
 * Rules the layer keeps:
 * - Content is always visible without JavaScript, in tests and during SSR. Load-time
 *   entrances (<Enter>) are pure CSS animations that end visible; scroll reveals
 *   (<Reveal>) are only hidden after <MotionRoot> has hydrated AND IntersectionObserver
 *   exists, and anything already on screen at that moment is never hidden.
 * - prefers-reduced-motion turns every effect off (CSS and JS).
 * - The CSS lives with the landing styles (landing.css, "motion layer" block).
 */
export { Enter, Reveal } from './reveal'
export type { EnterVariant } from './reveal'
export { MotionRoot } from './motion-root'
export { RotatingWords } from './rotating-words'
export { Parallax, ParallaxLayer } from './parallax'
export { ScrollDrift, ScrollHeader, ScrollProgress } from './scroll-effects'
export { prefersReducedMotion } from './media'
