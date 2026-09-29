import { isStorableHashtag, normaliseHashtag } from './parse'

/**
 * The normalised tag from a /hashtags/[tag] URL segment, or null when it is not a tag the
 * database can hold (the page then returns 404). Accepts an encoded "#" prefix and any case.
 */
export function hashtagFromParam(raw: string): string | null {
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  const tag = normaliseHashtag(decoded)
  return isStorableHashtag(tag) ? tag : null
}
