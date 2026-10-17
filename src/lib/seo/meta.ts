import type { Metadata } from 'next'

/**
 * Round H (H5): shared search metadata helpers.
 *
 * - metaDescription: plain text for search snippets and share cards. Markdown markers, emoji and raw line breaks
 *   are removed, whitespace collapsed, and the text cut at a word to at most 160 characters (aim 150–160).
 * - canonicalPath: the clean address of a page (no query string, no trailing slash, lower-case scheme/host).
 * - jsonLd: a JSON-LD script body that cannot close its <script> tag.
 */
export const META_DESCRIPTION_MAX = 160
const META_DESCRIPTION_MIN_CUT = 120

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu

export function plainText(value: string | null | undefined) {
  if (!value) return ''
  return value
    // Links: keep the label. Images: drop.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // List markers and headings at line start.
    .replace(/^\s{0,3}(?:[-*+]|\d{1,3}[.)]|#{1,6})\s+/gm, '')
    // Emphasis markers, code ticks, block quotes.
    .replace(/(\*\*|__|\*|_|`|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/^\s*>\s?/gm, '')
    .replace(EMOJI, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function metaDescription(...candidates: Array<string | null | undefined>) {
  const text = candidates.map(plainText).find(Boolean) ?? ''
  if (text.length <= META_DESCRIPTION_MAX) return text
  const cut = text.slice(0, META_DESCRIPTION_MAX - 1)
  const wordEnd = cut.lastIndexOf(' ')
  return `${cut.slice(0, wordEnd >= META_DESCRIPTION_MIN_CUT ? wordEnd : cut.length).replace(/[\s,.;:–-]+$/, '')}…`
}

export function canonicalPath(path: string) {
  const [withoutHash] = path.split('#')
  const [withoutQuery] = (withoutHash ?? '').split('?')
  const clean = (withoutQuery ?? '/').replace(/\/+$/, '')
  return clean || '/'
}

/** Metadata pieces every indexable page shares: canonical address and the same description for share cards. */
export function indexableMetadata(input: { title: string; description: string; path: string; images?: string[] }): Metadata {
  const canonical = canonicalPath(input.path)
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical },
    openGraph: { title: input.title, description: input.description, url: canonical, ...(input.images?.length ? { images: input.images } : {}) },
    twitter: { card: input.images?.length ? 'summary_large_image' : 'summary', title: input.title, description: input.description },
  }
}

export function jsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
