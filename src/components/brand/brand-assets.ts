/**
 * The Sea N Shore logo files (teal dragon-headed sailing ship + "Sea N Shore" script).
 * Every logo in the app points here, so a future brand refresh changes one file.
 * Pure data, safe to import from client and server code.
 *
 * The older artwork (sea-and-shore-*.svg/.webp, sea-n-shore-compact-lockup.webp …) stays in
 * public/brand for the deploy verification scripts, but no page uses it any more.
 */
export const BRAND_NAME = 'Sea N Shore'

export const BRAND_ASSETS = {
  /** Horizontal lockup for light backgrounds. 672×200. */
  lockup: { src: '/brand/sea-n-shore-lockup.webp', width: 672, height: 200 },
  /** Horizontal lockup in white for dark backgrounds. 672×200. */
  lockupWhite: { src: '/brand/sea-n-shore-lockup-white.webp', width: 672, height: 200 },
  /** Ship mark with the name underneath. 480×435. */
  stacked: { src: '/brand/sea-n-shore-stacked.webp', width: 480, height: 435 },
  /** Ship mark only. 296×360. */
  mark: { src: '/brand/sea-n-shore-mark.webp', width: 296, height: 360 },
  /** Ship mark only, white. 296×360. */
  markWhite: { src: '/brand/sea-n-shore-mark-white.webp', width: 296, height: 360 },
} as const

export const BRAND_ICONS = {
  favicon: '/favicon.ico',
  icon32: '/brand/favicon-32.png',
  apple: '/brand/apple-touch-icon.png',
  icon192: '/brand/icon-192.png',
  icon512: '/brand/icon-512.png',
  maskable512: '/brand/icon-maskable-512.png',
  ogImage: '/brand/og-image.png',
  manifest: '/manifest.webmanifest',
} as const
