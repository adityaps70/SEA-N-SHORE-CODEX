import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import opentype, { type Font } from 'opentype.js'

/**
 * Round I (I1): the share image's fonts and text fitting. The same self-hosted font files (Plus Jakarta Sans for
 * headings, Inter for the rest; SIL OFL 1.1, from the fontsource packages, in ./fonts) are given to Satori to draw
 * and to opentype.js to measure, so a line that measures as fitting is drawn as fitting. Text is wrapped here and
 * drawn one line per element (never wrapped again by Satori), with a small safety margin on every width.
 */
export type ShareFontRole = 'title' | 'heading' | 'body' | 'bodyStrong'

const FONT_FILES: Record<ShareFontRole, { family: string; weight: 400 | 600 | 700 | 800; files: string[] }> = {
  title: { family: 'Share Heading', weight: 800, files: ['plus-jakarta-sans-latin-800-normal.woff', 'plus-jakarta-sans-latin-ext-800-normal.woff'] },
  heading: { family: 'Share Heading', weight: 700, files: ['plus-jakarta-sans-latin-700-normal.woff', 'plus-jakarta-sans-latin-ext-700-normal.woff'] },
  body: { family: 'Share Body', weight: 400, files: ['inter-latin-400-normal.woff', 'inter-latin-ext-400-normal.woff'] },
  bodyStrong: { family: 'Share Body', weight: 600, files: ['inter-latin-600-normal.woff', 'inter-latin-ext-600-normal.woff'] },
}

export const SHARE_FONT_FAMILY: Record<ShareFontRole, { family: string; weight: number }> = Object.fromEntries(
  Object.entries(FONT_FILES).map(([role, entry]) => [role, { family: entry.family, weight: entry.weight }]),
) as Record<ShareFontRole, { family: string; weight: number }>

/** Widths are taken 4% wider than measured, so kerning and rounding in the renderer never push text out. */
const WIDTH_SAFETY = 1.04

type LoadedFonts = {
  satori: Array<{ name: string; data: Buffer; weight: 400 | 600 | 700 | 800; style: 'normal' }>
  measure: Record<ShareFontRole, Font[]>
}

let loaded: LoadedFonts | null = null

function fontDirectory() {
  return join(process.cwd(), 'src/features/jobs/share/fonts')
}

export function shareFonts(): LoadedFonts {
  if (loaded) return loaded
  const satori: LoadedFonts['satori'] = []
  const measure = {} as LoadedFonts['measure']
  for (const [role, entry] of Object.entries(FONT_FILES) as Array<[ShareFontRole, (typeof FONT_FILES)[ShareFontRole]]>) {
    measure[role] = entry.files.map((file) => {
      const data = readFileSync(join(fontDirectory(), file))
      satori.push({ name: entry.family, data, weight: entry.weight, style: 'normal' })
      return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    })
  }
  loaded = { satori, measure }
  return loaded
}

/** The width of `text` at `size` px, using the first font of the role that has each character. */
export function measureText(text: string, role: ShareFontRole, size: number) {
  const fonts = shareFonts().measure[role]
  let width = 0
  for (const character of text) {
    const font = fonts.find((candidate) => candidate.charToGlyphIndex(character) > 0) ?? fonts[0]!
    width += font.getAdvanceWidth(character, size)
  }
  return width * WIDTH_SAFETY
}

/** Greedy word wrap; a word wider than the line is broken between characters. */
export function wrapText(text: string, role: ShareFontRole, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  const push = (word: string) => {
    if (measureText(word, role, size) <= maxWidth) return [word]
    const pieces: string[] = []
    let piece = ''
    for (const character of word) {
      if (piece && measureText(piece + character, role, size) > maxWidth) {
        pieces.push(piece)
        piece = ''
      }
      piece += character
    }
    if (piece) pieces.push(piece)
    return pieces
  }
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (measureText(candidate, role, size) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    const pieces = push(word)
    lines.push(...pieces.slice(0, -1))
    line = pieces.at(-1) ?? ''
  }
  if (line) lines.push(line)
  return lines
}

/** Shortens `text` with "…" until it is at most `maxWidth` wide. */
export function truncateToWidth(text: string, role: ShareFontRole, size: number, maxWidth: number) {
  if (measureText(text, role, size) <= maxWidth) return text
  let kept = [...text]
  while (kept.length > 1 && measureText(`${kept.join('').trimEnd()}…`, role, size) > maxWidth) kept = kept.slice(0, -1)
  return `${kept.join('').trimEnd()}…`
}

export type FittedText = { size: number; lineHeight: number; lines: string[]; truncated: boolean }

/**
 * The largest size from `maxSize` down to `minSize` at which the text wraps into at most `maxLines` lines within
 * `maxWidth` and `maxHeight`. If it never does, the minimum size is used and the last line ends with "…": the
 * text is shortened, never clipped or drawn outside its box.
 */
export function fitText(input: {
  text: string
  role: ShareFontRole
  maxWidth: number
  maxHeight: number
  maxLines: number
  maxSize: number
  minSize: number
  lineHeight: number
}): FittedText {
  const step = Math.max(1, Math.round(input.maxSize / 40))
  for (let size = input.maxSize; size >= input.minSize; size -= step) {
    const lines = wrapText(input.text, input.role, size, input.maxWidth)
    if (lines.length <= input.maxLines && lines.length * size * input.lineHeight <= input.maxHeight) {
      return { size, lineHeight: input.lineHeight, lines, truncated: false }
    }
  }
  const size = input.minSize
  const fitLines = Math.max(1, Math.min(input.maxLines, Math.floor(input.maxHeight / (size * input.lineHeight))))
  const lines = wrapText(input.text, input.role, size, input.maxWidth)
  if (lines.length <= fitLines) return { size, lineHeight: input.lineHeight, lines, truncated: false }
  const kept = lines.slice(0, fitLines)
  kept[fitLines - 1] = truncateToWidth(`${kept[fitLines - 1]} ${lines.slice(fitLines).join(' ')}`, input.role, size, input.maxWidth)
  return { size, lineHeight: input.lineHeight, lines: kept, truncated: true }
}
