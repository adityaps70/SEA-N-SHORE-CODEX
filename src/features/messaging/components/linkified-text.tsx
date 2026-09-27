import { Fragment } from 'react'

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi
const TRAILING_PUNCTUATION = /[.,!?;:)\]}'"]+$/

export type TextPart = { type: 'text'; value: string } | { type: 'link'; value: string; href: string }

/** Splits message text into plain text and http(s) links. Trailing punctuation stays outside the link. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    let raw = match[0]
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? ''
    if (trailing) raw = raw.slice(0, raw.length - trailing.length)
    if (!raw) continue
    let href: string
    try {
      const url = new URL(raw)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      href = url.toString()
    } catch {
      continue
    }
    if (start > last) parts.push({ type: 'text', value: text.slice(last, start) })
    parts.push({ type: 'link', value: raw, href })
    last = start + raw.length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}

/** Renders message text with clickable links. Links open in a new tab and never pass the referrer on. */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, index) => (
        part.type === 'link' ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-semibold underline decoration-1 underline-offset-2 [overflow-wrap:anywhere]"
          >
            {part.value}
          </a>
        ) : (
          <Fragment key={index}>{part.value}</Fragment>
        )
      ))}
    </>
  )
}
