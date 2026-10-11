/** About how long an article takes to read (learning round E): 220 words a minute, at least one minute. */
export const READING_WORDS_PER_MINUTE = 220

export function articleWordCount(body: string, format: 'plain' | 'html') {
  const text = format === 'html'
    ? body.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
    : body
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
}

export function readingMinutes(body: string | null | undefined, format: 'plain' | 'html') {
  if (!body) return 0
  return Math.max(1, Math.round(articleWordCount(body, format) / READING_WORDS_PER_MINUTE))
}
