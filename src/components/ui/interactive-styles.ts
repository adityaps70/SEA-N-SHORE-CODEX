/**
 * Shared affordance styles so every clickable element looks clickable:
 * a fill or visible border, a hover change, cursor-pointer and a visible focus ring.
 * The `disabled:` values restore the resting look so disabled buttons do not react to hover.
 */

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2'

/** Filled navy button: the main action in a group. */
export const primaryButtonClass = `inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:cursor-not-allowed disabled:bg-navy-950 disabled:opacity-60 ${focusRing}`

/** Bordered white button: secondary actions next to a primary one. */
export const secondaryButtonClass = `inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition-colors hover:border-ocean-300 hover:bg-mist-50 disabled:cursor-not-allowed disabled:border-mist-200 disabled:bg-white disabled:opacity-60 ${focusRing}`

/** Bordered button that turns red on hover: report and other safety actions. */
export const reportButtonClass = `inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-3.5 text-sm font-semibold text-navy-950 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-800 ${focusRing}`

/** Inline text link. */
export const textLinkClass = 'cursor-pointer font-semibold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline'

/** "Back to …" link above a page. */
export const backLinkClass = 'inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline'

/** Square icon-only button with a visible 36px+ hit area. Pair with an aria-label. */
export const iconButtonClass = `inline-grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl text-muted transition-colors hover:bg-mist-100 hover:text-navy-950 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted disabled:opacity-40 ${focusRing}`
