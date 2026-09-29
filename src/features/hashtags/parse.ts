/**
 * Hashtag parsing shared by the composer, the post text renderer and the server.
 *
 * A hashtag is "#" followed by letters, digits or underscores, and must start at the beginning
 * of the text or after whitespace / an opening bracket, so "#" inside URLs (example.com/a#top),
 * emails and "C#" are not tags. Tags are stored normalised (lower-case, no "#").
 */

export const HASHTAG_MAX_LENGTH = 64
export const HASHTAGS_PER_POST_MAX = 30

const HASHTAG_PATTERN = /(^|[\s(\[{'"“‘])#([\p{L}\p{N}_]+)/gu
const NORMALISED_HASHTAG = /^[a-z0-9_]{1,64}$/

export type HashtagMatch = {
  /** The tag as typed, without "#". */
  raw: string
  /** Lower-cased tag, the stored form. */
  tag: string
  /** Index of "#" in the text. */
  start: number
  /** Index just past the last tag character. */
  end: number
}

/** Every hashtag in the text, in order, including repeats. */
export function findHashtags(text: string): HashtagMatch[] {
  const matches: HashtagMatch[] = []
  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    const prefix = match[1] ?? ''
    const raw = match[2] ?? ''
    if (!raw || raw.length > HASHTAG_MAX_LENGTH) continue
    if (/^\d+$/.test(raw)) continue // "#1" is a number, not a topic
    const start = (match.index ?? 0) + prefix.length
    matches.push({ raw, tag: normaliseHashtag(raw), start, end: start + 1 + raw.length })
  }
  return matches
}

/** Lower-case, "#" stripped. Keeps only characters the database accepts. */
export function normaliseHashtag(value: string) {
  return value.trim().replace(/^#+/, '').toLowerCase()
}

/** Unique normalised hashtags in order of first appearance, capped per post. */
export function extractHashtags(text: string, limit = HASHTAGS_PER_POST_MAX): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const match of findHashtags(text)) {
    if (!isStorableHashtag(match.tag) || seen.has(match.tag)) continue
    seen.add(match.tag)
    tags.push(match.tag)
    if (tags.length >= limit) break
  }
  return tags
}

/** True when the normalised tag fits the database check (ASCII letters, digits, underscore). */
export function isStorableHashtag(tag: string) {
  return NORMALISED_HASHTAG.test(tag)
}

/** The hashtag the caret is currently typing ("#sir" -> "sir"), or null. */
export function activeHashtagQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const hash = before.lastIndexOf('#')
  if (hash < 0) return null
  if (hash > 0 && !/[\s(\[{'"“‘]/.test(before[hash - 1] ?? '')) return null
  const query = before.slice(hash + 1)
  if (!/^[\p{L}\p{N}_]*$/u.test(query)) return null
  return { query: normaliseHashtag(query), start: hash }
}

export function hashtagHref(tag: string) {
  return `/hashtags/${encodeURIComponent(normaliseHashtag(tag))}`
}
