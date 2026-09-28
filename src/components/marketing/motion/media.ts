/** True when the visitor asked for reduced motion. Safe where matchMedia is missing (jsdom). */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** True for a mouse or trackpad (pointer effects are skipped on touch screens). */
export function hasFinePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: fine)').matches
}
