import sanitizeHtml from 'sanitize-html'

/**
 * Rich-text lessons. Article bodies are stored either as plain text (every article written before
 * rich text, article_format = 'plain') or as HTML from the lesson editor (article_format = 'html').
 *
 * HTML is sanitized with an allow-list on the server before it is saved and again before it is
 * rendered: no scripts, no event handlers, no styles or classes, no iframes or embeds (videos use the
 * embed material type), links only to http(s) and mailto, and images only from the course's own
 * private media (referenced by storage path and signed at render time; never an outside URL).
 */

export type ArticleFormat = 'plain' | 'html'

/** Images in an article reference the private media bucket by storage path, never by URL. */
export const ARTICLE_IMAGE_PATH_ATTRIBUTE = 'data-storage-path'
const ARTICLE_IMAGE_PATH = /^learning\/[^/]{1,200}\/[0-9a-f-]{36}\/lesson_image\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i

const ALLOWED_TAGS = [
  'p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
  'a', 'ul', 'ol', 'li', 'blockquote', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
]

function sanitize(html: string, options: { keepImageSources: boolean }) {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      // target and rel are always set by transformTags below; whatever the author sent is replaced.
      a: ['href', 'title', 'target', 'rel'],
      img: [ARTICLE_IMAGE_PATH_ATTRIBUTE, 'alt', ...(options.keepImageSources ? ['src'] : [])],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    // Content of dangerous elements is dropped with them, not left behind as text.
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
    transformTags: {
      // Headings are capped at h2 (the lesson title is the page's h1).
      h1: 'h2',
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
    },
    exclusiveFilter: (frame) => {
      // An image is kept only when it points at course media by storage path.
      if (frame.tag !== 'img') return false
      return !ARTICLE_IMAGE_PATH.test(frame.attribs[ARTICLE_IMAGE_PATH_ATTRIBUTE] ?? '')
    },
  }).trim()
}

/** The allow-listed form of editor HTML, as stored. Image `src` (a short-lived URL) is never stored. */
export function sanitizeArticleHtml(html: string) {
  return sanitize(html, { keepImageSources: false })
}

/** Storage paths of every image an article uses (for checking they belong to the course). */
export function articleImagePaths(html: string) {
  const paths = new Set<string>()
  const pattern = new RegExp(`${ARTICLE_IMAGE_PATH_ATTRIBUTE}="([^"]+)"`, 'g')
  for (const match of sanitizeArticleHtml(html).matchAll(pattern)) {
    if (match[1]) paths.add(match[1])
  }
  return [...paths]
}

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * A plain-text article as editor HTML, the first time it is edited: blank lines separate
 * paragraphs and single line breaks are kept. Nothing is rewritten until the trainer saves.
 */
export function plainTextToArticleHtml(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('')
}

/**
 * Article HTML ready to render: sanitized again, with each course image's storage path swapped for a
 * signed URL from `signImage` (images that can't be signed are dropped).
 */
export async function renderArticleHtml(html: string, signImage: (storagePath: string) => Promise<string | null>) {
  const stored = sanitizeArticleHtml(html)
  const pattern = new RegExp(`<img ([^>]*?)${ARTICLE_IMAGE_PATH_ATTRIBUTE}="([^"]+)"([^>]*)>`, 'g')
  const replacements = new Map<string, string>()
  for (const match of stored.matchAll(pattern)) {
    const path = match[2]!
    if (replacements.has(path)) continue
    const url = await signImage(path).catch(() => null)
    replacements.set(path, url ?? '')
  }
  const withSources = stored.replace(pattern, (whole, before: string, path: string, after: string) => {
    const url = replacements.get(path)
    if (!url) return ''
    return `<img ${before}${ARTICLE_IMAGE_PATH_ATTRIBUTE}="${path}" src="${escapeHtml(url)}"${after}>`
  })
  return sanitize(withSources, { keepImageSources: true })
}

/** Plain text of an article in either format, for summaries and search. */
export function articlePlainText(body: string, format: ArticleFormat) {
  if (format === 'plain') return body
  return sanitizeHtml(body, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim()
}
