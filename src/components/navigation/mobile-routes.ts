/**
 * Phone routing rules for the round 8 mobile shell.
 *
 * Detail routes show their own `MobilePageBar` (back arrow + title) instead of the global phone
 * top bar, and full-screen routes also hide the bottom tab bar (composer-like screens, chat,
 * course player, full-screen editors).
 */
const DETAIL_PATTERNS: RegExp[] = [
  /^\/posts\/[^/]+/,
  /^\/jobs\/(?!saved$|applications$|alerts$)[^/]+$/,
  /^\/jobs\/(saved|applications|alerts)$/,
  /^\/hiring(\/.*)?$/,
  /^\/events\/[^/]+/,
  /^\/learn\/courses\/[^/]+/,
  /^\/learn\/(my-learning|teach|studio)(\/.*)?$/,
  /^\/messages(\/.*)?$/,
  /^\/settings(\/.*)?$/,
  /^\/activities$/,
  /^\/saved$/,
  /^\/search$/,
  /^\/plans$/,
  /^\/creator$/,
  /^\/profile\/edit$/,
  /^\/organizations\/.+/,
  /^\/community\/.+/,
  /^\/hashtags\/.+/,
  /^\/people\/.+/,
  /^\/admin(\/.*)?$/,
]

const FULL_SCREEN_PATTERNS: RegExp[] = [
  /^\/messages\/[^/]+$/,
  /^\/learn\/courses\/[^/]+\/learn$/,
  /^\/profile\/edit$/,
  /^\/hiring\/jobs\/(new|[^/]+\/edit)$/,
  /^\/events\/(create|new|[^/]+\/edit)$/,
  /^\/learn\/studio\/courses\/.+/,
]

export function isPhoneDetailRoute(pathname: string): boolean {
  return DETAIL_PATTERNS.some((pattern) => pattern.test(pathname))
}

export function isPhoneFullScreenRoute(pathname: string): boolean {
  return FULL_SCREEN_PATTERNS.some((pattern) => pattern.test(pathname))
}
