/**
 * Round I (I3): the Home Screen app marker. The browser sets `sns_display_mode=standalone` when the site runs as an
 * app added to the home screen (display-mode standalone, or iOS `navigator.standalone`), and removes it in a browser
 * tab. On iPhone the Home Screen app keeps its own cookies, apart from Safari, so the marker tells the server which
 * of the two a request comes from. It only names the device in Active sessions and opens the feed instead of the
 * landing page at launch; it grants nothing, so it is a plain (not HTTP-only) cookie.
 */
export const DISPLAY_MODE_COOKIE = 'sns_display_mode'
export const STANDALONE_DISPLAY_MODE = 'standalone'

export function isStandaloneCookie(value: string | null | undefined) {
  return value === STANDALONE_DISPLAY_MODE
}

/** The marker from a raw Cookie header (for code that only has headers). */
export function standaloneFromCookieHeader(cookieHeader: string | null | undefined) {
  if (!cookieHeader) return false
  return cookieHeader.split(';').some((part) => {
    const [name, ...rest] = part.trim().split('=')
    return name === DISPLAY_MODE_COOKIE && isStandaloneCookie(rest.join('='))
  })
}

type DisplayModeWindow = {
  matchMedia?: (query: string) => { matches: boolean }
  navigator?: { standalone?: boolean; userAgent?: string; maxTouchPoints?: number }
}

/** True when this page runs as a Home Screen (or installed) app. */
export function runningStandalone(view: DisplayModeWindow) {
  if (view.navigator?.standalone === true) return true
  try {
    return Boolean(view.matchMedia?.('(display-mode: standalone)').matches || view.matchMedia?.('(display-mode: fullscreen)').matches)
  } catch {
    return false
  }
}

/** iPhone or iPad Home Screen app: Google sign-in there opens in a separate Safari window with its own cookies. */
export function runningIosHomeScreenApp(view: DisplayModeWindow) {
  if (!runningStandalone(view)) return false
  const agent = view.navigator?.userAgent ?? ''
  const ios = /\b(iPhone|iPad|iPod)\b/.test(agent) || (/\bMacintosh\b/.test(agent) && (view.navigator?.maxTouchPoints ?? 0) > 1)
  return ios || view.navigator?.standalone === true
}

/** The cookie line the browser writes: a year, the whole site, never sent cross-site. */
export function displayModeCookieLine(standalone: boolean, secure: boolean) {
  const flags = `Path=/; SameSite=Lax${secure ? '; Secure' : ''}`
  return standalone
    ? `${DISPLAY_MODE_COOKIE}=${STANDALONE_DISPLAY_MODE}; Max-Age=31536000; ${flags}`
    : `${DISPLAY_MODE_COOKIE}=; Max-Age=0; ${flags}`
}
