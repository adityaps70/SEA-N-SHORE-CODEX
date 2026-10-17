/**
 * Shared affordance styles so every clickable element looks clickable:
 * a fill or visible border, a hover change, cursor-pointer and a visible focus ring.
 * The `disabled:` values restore the resting look so disabled buttons do not react to hover.
 */

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet'
/** `md` is the default form button (min-h-12); `sm` is the compact toolbar and card button (min-h-10). */
export type ButtonSize = 'md' | 'sm'
export type ButtonClassOptions = { variant?: ButtonVariant; size?: ButtonSize }

const buttonBase = `inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`

const buttonSizes: Record<ButtonSize, string> = {
  md: 'min-h-12 px-5',
  sm: 'min-h-10 px-4',
}

const buttonVariants: Record<ButtonVariant, string> = {
  /** Filled navy: the one primary colour across the site. */
  primary: 'bg-navy-950 text-white hover:bg-navy-800 disabled:bg-navy-950',
  /** Bordered white: secondary actions next to a primary one. */
  secondary: 'border border-mist-200 bg-white text-navy-950 hover:border-ocean-300 hover:bg-mist-50 disabled:border-mist-200 disabled:bg-white',
  /** No fill or border until hover: tertiary actions. */
  quiet: 'text-navy-900 hover:bg-mist-100 disabled:bg-transparent',
}

/**
 * The single source of button classes. `<Button>` uses it, and so does anything styled as a button
 * (`<Link>`, `<IntentLink>`, `<a>`, `<label>`), so links and buttons stay identical.
 * Accepts a variant name or `{ variant, size }`; defaults to `{ variant: 'primary', size: 'md' }`.
 * Layout extras (w-full, flex-1, rounded-full on phones) go alongside it through `cn(...)`.
 */
export function buttonClass(options: ButtonVariant | ButtonClassOptions = {}): string {
  const { variant = 'primary', size = 'md' } = typeof options === 'string' ? { variant: options } : options
  return `${buttonBase} ${buttonSizes[size]} ${buttonVariants[variant]}`
}

/** Filled navy button: the main action in a group (compact size). */
export const primaryButtonClass = buttonClass({ variant: 'primary', size: 'sm' })

/** Bordered white button: secondary actions next to a primary one (compact size). */
export const secondaryButtonClass = buttonClass({ variant: 'secondary', size: 'sm' })

/** Bordered button that turns red on hover: report and other safety actions. */
export const reportButtonClass = `inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-3.5 text-sm font-semibold text-navy-950 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-800 ${focusRing}`

/** Inline text link. */
export const textLinkClass = 'cursor-pointer font-semibold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline'

/** "Back to …" link above a page. */
export const backLinkClass = 'inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline'

/** Square icon-only button with a visible 36px+ hit area. Pair with an aria-label. */
export const iconButtonClass = `inline-grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl text-muted transition-colors hover:bg-mist-100 hover:text-navy-950 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted disabled:opacity-40 ${focusRing}`
