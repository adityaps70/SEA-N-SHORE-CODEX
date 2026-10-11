/**
 * Learning round E (E5): a one-off converter for legacy plain-text articles (the SIRE course) into the rich-text
 * format the article renderer styles. It changes layout only, never wording:
 * - an ALL-CAPS line, or a numbered "1. TITLE" line, becomes an H2 in Title Case (known acronyms stay capitals);
 * - "- " (or "• ") lines become a bulleted list;
 * - other lines become paragraphs; a hard-wrapped line (the previous one has no closing punctuation and this one
 *   starts in lower case) joins its paragraph.
 * The result is saved into a draft revision for the owner to review; nothing is published by this code.
 */

const ACRONYMS = new Set([
  'SIRE', 'OCIMF', 'VIQ', 'VIQ7', 'PIQ', 'HVPQ', 'SMS', 'ISM', 'ISPS', 'MARPOL', 'SOLAS', 'STCW', 'IMO', 'OVID', 'CDI',
  'HSE', 'HSEQ', 'TMSA', 'PPE', 'MLC', 'PSC', 'CAP', 'DPA', 'CSO', 'SSO', 'ECDIS', 'GMDSS', 'AIS', 'ARPA', 'BRM', 'ERM',
  'BTM', 'LNG', 'LPG', 'IGS', 'COW', 'SOPEP', 'SMPEP', 'VGP', 'ODME', 'OWS', 'ORB', 'GHG', 'EEXI', 'CII', 'SEEMP', 'KPI',
  'KPIS', 'MOC', 'JHA', 'JSA', 'PTW', 'LOTO', 'QA', 'QC', 'UK', 'US', 'USA', 'EU', 'IT', 'OOW', 'CE', 'CO', 'C/O', 'C/E',
  'II', 'III', 'IV', 'AI', 'FAQ', 'FAQS', 'Q&A', 'STS', 'SBM', 'SPM', 'CBT', 'OJT', 'SMC', 'DOC',
])
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'nor', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'as', 'vs', 'via', 'per'])

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hasLetters(text: string) {
  return /\p{L}/u.test(text)
}

function isAllCaps(text: string) {
  return hasLetters(text) && !/\p{Ll}/u.test(text) && (text.match(/\p{Lu}/gu)?.length ?? 0) >= 3
}

const NUMBERED_HEADING = /^(\d+(?:\.\d+)*[.)]?)\s+(.+)$/

/** A heading line: ALL CAPS, or "1. TITLE" / "2.3 TITLE" with an all-caps title. Short lines only. */
export function isLegacyHeading(line: string) {
  const text = line.trim()
  if (!text || text.length > 120) return false
  const numbered = NUMBERED_HEADING.exec(text)
  if (numbered) return isAllCaps(numbered[2]!)
  return isAllCaps(text)
}

function titleWord(word: string, edge: boolean) {
  // Keep punctuation around the word: "(SIRE" → "(SIRE", "INSPECTION:" → "Inspection:".
  const match = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(word)
  if (!match) return word
  const [, lead, core, trail] = match
  if (!core) return word
  // Known acronyms, anything with a digit, and a short word in brackets ("(STS)") keep their capitals.
  if (ACRONYMS.has(core.toUpperCase()) || /\d/.test(core) || (lead.includes('(') && trail.includes(')') && core.length <= 6)) return `${lead}${core}${trail}`
  const lower = core.toLowerCase()
  // Small words stay lower case, except as the first or last word.
  if (!edge && SMALL_WORDS.has(lower) && !lead) return `${lead}${lower}${trail}`
  // Hyphenated words capitalise each part: "SHIP-TO-SHIP" → "Ship-to-Ship".
  const cased = lower.split('-').map((part, index) => (index > 0 && SMALL_WORDS.has(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('-')
  return `${lead}${cased}${trail}`
}

/** "1. INSPECTION DAY ON BOARD THE VESSEL" → "1. Inspection Day on Board the Vessel". */
export function toTitleCase(line: string) {
  const text = line.trim()
  const numbered = NUMBERED_HEADING.exec(text)
  const prefix = numbered ? `${numbered[1]} ` : ''
  const body = numbered ? numbered[2]! : text
  const words = body.split(/\s+/)
  return prefix + words.map((word, index) => titleWord(word, index === 0 || index === words.length - 1)).join(' ')
}

const BULLET = /^\s*[-•*]\s+(.*)$/

export type LegacyConversion = {
  html: string
  headings: string[]
  paragraphs: number
  lists: number
  listItems: number
}

export function convertLegacyArticle(text: string): LegacyConversion {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: string[] = []
  const headings: string[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let paragraphs = 0
  let lists = 0
  let listItems = 0

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(`<p>${escapeHtml(paragraph.join(' '))}</p>`)
    paragraphs += 1
    paragraph = []
  }
  const flushList = () => {
    if (!list.length) return
    blocks.push(`<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`)
    lists += 1
    listItems += list.length
    list = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet && bullet[1]!.trim()) {
      flushParagraph()
      list.push(bullet[1]!.trim())
      continue
    }
    if (isLegacyHeading(line)) {
      flushParagraph()
      flushList()
      const heading = toTitleCase(line)
      headings.push(heading)
      blocks.push(`<h2>${escapeHtml(heading)}</h2>`)
      continue
    }
    flushList()
    const previous = paragraph[paragraph.length - 1]
    const continues = previous !== undefined && !/[.!?:;"”')\]]$/.test(previous) && /^\p{Ll}/u.test(line)
    if (!continues) flushParagraph()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()

  return { html: blocks.join('\n'), headings, paragraphs, lists, listItems }
}
