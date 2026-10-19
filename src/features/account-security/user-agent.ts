/**
 * Round H (H3): a short "Browser on Device" summary of a User-Agent header, for Settings › Account › Active
 * sessions. Only the summary is stored, never the raw header.
 */
export type DeviceKind = 'phone' | 'tablet' | 'computer' | 'unknown'

export type UserAgentSummary = {
  browser: string | null
  device: string | null
  kind: DeviceKind
  summary: string | null
}

function browserOf(ua: string): string | null {
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return 'Edge'
  if (/\b(OPR|Opera)\//.test(ua)) return 'Opera'
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet'
  if (/\b(Firefox|FxiOS)\//.test(ua)) return 'Firefox'
  if (/\b(Chrome|CriOS|Chromium)\//.test(ua)) return 'Chrome'
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(ua) || (/\bAppleWebKit\//.test(ua) && /\b(iPhone|iPad|Macintosh)\b/.test(ua))) return 'Safari'
  return null
}

function deviceOf(ua: string): { device: string | null; kind: DeviceKind } {
  if (/\biPhone\b/.test(ua)) return { device: 'iPhone', kind: 'phone' }
  if (/\biPad\b/.test(ua)) return { device: 'iPad', kind: 'tablet' }
  if (/\bAndroid\b/.test(ua)) return /\bMobile\b/.test(ua) ? { device: 'Android phone', kind: 'phone' } : { device: 'Android tablet', kind: 'tablet' }
  if (/\bCrOS\b/.test(ua)) return { device: 'Chromebook', kind: 'computer' }
  if (/\bWindows\b/.test(ua)) return { device: 'Windows', kind: 'computer' }
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) return { device: 'Mac', kind: 'computer' }
  if (/\bLinux\b/.test(ua)) return { device: 'Linux', kind: 'computer' }
  return { device: null, kind: 'unknown' }
}

/**
 * Round I (I3): `standalone` (the Home Screen app marker, lib/pwa/display-mode) names the app, not the browser:
 * "Home Screen app on iPhone" (iPhone and iPad keep it apart from Safari, so it is its own device) or
 * "Installed app on Android phone".
 */
export function summarizeUserAgent(userAgent: string | null | undefined, options: { standalone?: boolean } = {}): UserAgentSummary {
  const ua = (userAgent ?? '').slice(0, 512)
  if (!ua.trim()) return { browser: null, device: null, kind: 'unknown', summary: null }
  const { device, kind } = deviceOf(ua)
  const browser = options.standalone
    ? device === 'iPhone' || device === 'iPad' ? 'Home Screen app' : 'Installed app'
    : browserOf(ua)
  const summary = browser && device ? `${browser} on ${device}` : browser ?? device
  return { browser, device, kind, summary: summary ? summary.slice(0, 120) : null }
}

/** The device kind back from a stored summary (for the icon on the sessions list). */
export function deviceKindOfSummary(summary: string | null): DeviceKind {
  if (!summary) return 'unknown'
  if (/iPhone|Android phone/.test(summary)) return 'phone'
  if (/iPad|Android tablet/.test(summary)) return 'tablet'
  if (/Windows|Mac|Linux|Chromebook/.test(summary)) return 'computer'
  return 'unknown'
}
