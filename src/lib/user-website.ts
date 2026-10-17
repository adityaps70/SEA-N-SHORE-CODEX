/**
 * Round H (H7): links to websites that members and organizations typed in. Search engines must not credit them
 * (nofollow, ugc), and the new tab gets no handle on this page or its address (noopener, noreferrer).
 */
export const USER_WEBSITE_REL = 'nofollow ugc noopener noreferrer'

/** The website as a safe link target: http(s) only, a bare domain gets https://; null for anything else. */
export function userWebsiteHref(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}
