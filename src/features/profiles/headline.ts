/**
 * Round H (H7): a headline says what the member does; a bare web address is refused (server-side zod and in the
 * form). Client-safe.
 */
export const HEADLINE_URL_MESSAGE = 'Your headline should say what you do, not link to a website. Add links to your About section instead.'

const COMMON_TLDS = /\.(?:com|net|org|in|co|io|me|info|biz|app|dev|ai|uk|us|ae|sg|gr|de|nl|no|online|site|xyz|page|link)$/i

/** True when the whole headline is a web address ("https://…", "www.…", "example.com/me", "example.com"). */
export function isUrlOnlyHeadline(value: string | null | undefined) {
  const text = value?.trim() ?? ''
  if (!text || /\s/.test(text)) return false
  if (/^(?:https?:\/\/|www\.)\S+$/i.test(text)) return true
  const host = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/\S*)?$/i.exec(text)
  if (!host) return false
  return Boolean(host[2]) || COMMON_TLDS.test(host[1]!)
}
