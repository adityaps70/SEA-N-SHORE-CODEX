/**
 * Round H (H2): the small, safe subset of Markdown that post and comment bodies render.
 *
 * Supported: **bold**, *italic* / _italic_, "- " / "* " bullet lists, "1. " numbered lists and
 * [text](url) links. Everything else, raw HTML included, stays literal text: this module only
 * builds a tree of plain values that the renderer turns into React elements, so nothing is ever
 * parsed as HTML or injected with dangerouslySetInnerHTML.
 *
 * Links: only http(s) URLs and same-site paths ("/jobs") become links. javascript:, data:,
 * vbscript:, protocol-relative ("//host", "/\host") and mailto: targets render as the literal
 * source text (mailto is dropped on purpose so member emails are not turned into harvestable
 * links). Bare URLs are not linked, as before.
 *
 * Mentions and hashtags are worked out first (segmentBody) and arrive here as opaque atoms, so
 * Markdown is only read from plain text and "**@Member A**" keeps its profile link inside the bold.
 */

/** One piece of the body: plain text, or an atom (mention, organization, hashtag) kept whole. */
export type MarkdownSource<T> = { kind: 'text'; value: string } | { kind: 'atom'; value: string; atom: T }

/** Every node carries `start`, its offset in the body, so a collapsed body can be cut safely. */
export type MarkdownInline<T> =
  | { type: 'text'; value: string; start: number }
  | { type: 'atom'; value: string; atom: T; start: number }
  | { type: 'strong'; children: MarkdownInline<T>[]; start: number }
  | { type: 'emphasis'; children: MarkdownInline<T>[]; start: number }
  | { type: 'link'; href: string; external: boolean; label: string; start: number }

export type MarkdownListItem<T> = { marker: string; children: MarkdownInline<T>[]; start: number }

export type MarkdownBlock<T> =
  /** Ordinary lines, newlines included (the renderer keeps whitespace-pre-wrap). */
  | { type: 'text'; children: MarkdownInline<T>[]; start: number }
  | { type: 'list'; ordered: boolean; items: MarkdownListItem<T>[]; start: number }

type Unit<T> = { kind: 'char'; ch: string; pos: number } | { kind: 'atom'; value: string; atom: T; pos: number }

type Delimiter = {
  type: 'delimiter'
  ch: '*' | '_'
  count: number
  original: number
  canOpen: boolean
  canClose: boolean
  /** Offset of the first delimiter character still unused. */
  start: number
}

type Working<T> = MarkdownInline<T> | Delimiter

const BULLET = /^ {0,3}[-*][ \t]+(?=\S)/
const NUMBERED = /^ {0,3}(\d{1,3})\.[ \t]+(?=\S)/
const ESCAPABLE = new Set(['\\', '*', '_', '[', ']', '(', ')', '-'])
const WHITESPACE = /\s/
const PUNCTUATION = /[\p{P}\p{S}]/u
const MAX_URL_LENGTH = 2048
/** Atoms stand in as one non-space letter-like character for the line patterns. */
const ATOM_CHAR = '￼'

/**
 * A link target that is safe to render, or null. Only absolute http(s) URLs and same-site paths
 * starting with a single "/" qualify; the URL is re-serialised so what renders is what was checked.
 */
export function safeLinkTarget(raw: string): { href: string; external: boolean } | null {
  const value = raw.trim()
  if (!value || value.length > MAX_URL_LENGTH) return null
  // Control characters and whitespace can hide a scheme from naive checks; never accept them.
  if (/[\u0000- \u007f-\u009f\\]/.test(value)) return null
  if (value.startsWith('/')) {
    if (value.startsWith('//')) return null
    return { href: value, external: false }
  }
  if (!/^https?:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname || url.username || url.password) return null
    return { href: url.href, external: true }
  } catch {
    return null
  }
}

function toUnits<T>(segments: ReadonlyArray<MarkdownSource<T>>): Unit<T>[] {
  const units: Unit<T>[] = []
  let pos = 0
  for (const segment of segments) {
    if (segment.kind === 'atom') {
      units.push({ kind: 'atom', value: segment.value, atom: segment.atom, pos })
    } else {
      for (let index = 0; index < segment.value.length; index += 1) {
        units.push({ kind: 'char', ch: segment.value[index]!, pos: pos + index })
      }
    }
    pos += segment.value.length
  }
  return units
}

function charAt<T>(units: Unit<T>[], index: number) {
  const unit = units[index]
  if (!unit) return null
  return unit.kind === 'char' ? unit.ch : ATOM_CHAR
}

/** "[label](target)" starting at `from`, or null. The label is plain text; atoms keep their text. */
function readLink<T>(units: Unit<T>[], from: number, to: number): { node: MarkdownInline<T>; end: number } | null {
  let close = -1
  for (let index = from + 1; index < to; index += 1) {
    const ch = charAt(units, index)
    if (ch === '[') return null
    if (ch === ']') {
      close = index
      break
    }
  }
  if (close < 0 || charAt(units, close + 1) !== '(') return null

  let depth = 0
  let end = -1
  for (let index = close + 2; index < to; index += 1) {
    const unit = units[index]!
    if (unit.kind === 'atom' || WHITESPACE.test(unit.ch)) return null
    if (unit.ch === '(') depth += 1
    else if (unit.ch === ')') {
      if (depth === 0) {
        end = index
        break
      }
      depth -= 1
    }
  }
  if (end < 0) return null

  const text = (start: number, stop: number) => units.slice(start, stop).map((unit) => unit.kind === 'char' ? unit.ch : unit.value).join('')
  const label = text(from + 1, close)
  const target = text(close + 2, end)
  const start = units[from]!.pos
  const safe = label.trim() ? safeLinkTarget(target) : null
  // An unsafe or empty link stays exactly as typed, as inert text.
  const node: MarkdownInline<T> = safe
    ? { type: 'link', href: safe.href, external: safe.external, label, start }
    : { type: 'text', value: text(from, end + 1), start }
  return { node, end: end + 1 }
}

/** CommonMark's flanking rules decide whether a run of "*" or "_" can open or close emphasis. */
function delimiterAt<T>(units: Unit<T>[], from: number, to: number, lineStart: number): Delimiter {
  const ch = charAt(units, from) as '*' | '_'
  let end = from
  while (end < to && charAt(units, end) === ch) end += 1
  const before = from > lineStart ? charAt(units, from - 1) : null
  const after = end < to ? charAt(units, end) : null
  const beforeSpace = before === null || WHITESPACE.test(before)
  const afterSpace = after === null || WHITESPACE.test(after)
  const beforePunct = before !== null && before !== ATOM_CHAR && PUNCTUATION.test(before)
  const afterPunct = after !== null && after !== ATOM_CHAR && PUNCTUATION.test(after)
  const leftFlanking = !afterSpace && (!afterPunct || beforeSpace || beforePunct)
  const rightFlanking = !beforeSpace && (!beforePunct || afterSpace || afterPunct)
  const canOpen = ch === '*' ? leftFlanking : leftFlanking && (!rightFlanking || beforePunct)
  const canClose = ch === '*' ? rightFlanking : rightFlanking && (!leftFlanking || afterPunct)
  const count = end - from
  return { type: 'delimiter', ch, count, original: count, canOpen, canClose, start: units[from]!.pos }
}

function delimiterText(delimiter: Delimiter): MarkdownInline<never> {
  return { type: 'text', value: delimiter.ch.repeat(delimiter.count), start: delimiter.start }
}

function settle<T>(nodes: Working<T>[]): MarkdownInline<T>[] {
  const settled: MarkdownInline<T>[] = []
  for (const node of nodes) {
    const inline = node.type === 'delimiter' ? (node.count ? delimiterText(node) : null) : node
    if (!inline) continue
    const previous = settled[settled.length - 1]
    // Merge neighbouring text so the renderer gets tidy runs.
    if (inline.type === 'text' && previous?.type === 'text' && previous.start + previous.value.length === inline.start) {
      settled[settled.length - 1] = { ...previous, value: previous.value + inline.value }
    } else {
      settled.push(inline)
    }
  }
  return settled
}

/** Pairs emphasis delimiters (CommonMark "process emphasis", simplified) into strong/emphasis nodes. */
function processEmphasis<T>(nodes: Working<T>[]): MarkdownInline<T>[] {
  for (let closerIndex = 0; closerIndex < nodes.length; closerIndex += 1) {
    const closer = nodes[closerIndex]!
    if (closer.type !== 'delimiter' || !closer.canClose) continue
    while (closer.count > 0) {
      let openerIndex = -1
      for (let index = closerIndex - 1; index >= 0; index -= 1) {
        const candidate = nodes[index]!
        if (candidate.type !== 'delimiter' || candidate.ch !== closer.ch || !candidate.canOpen || !candidate.count) continue
        const bothWays = (candidate.canOpen && candidate.canClose) || (closer.canOpen && closer.canClose)
        if (bothWays && (candidate.original + closer.original) % 3 === 0 && (candidate.original % 3 !== 0 || closer.original % 3 !== 0)) continue
        openerIndex = index
        break
      }
      if (openerIndex < 0) break
      const opener = nodes[openerIndex] as Delimiter
      const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1
      opener.count -= use
      const children = settle(nodes.slice(openerIndex + 1, closerIndex))
      const wrapStart = opener.start + opener.count
      const wrapped: MarkdownInline<T> = use === 2 ? { type: 'strong', children, start: wrapStart } : { type: 'emphasis', children, start: wrapStart }
      closer.count -= use
      closer.start += use
      nodes.splice(openerIndex + 1, closerIndex - openerIndex - 1, wrapped)
      closerIndex = openerIndex + 2
      if (!opener.count) {
        nodes.splice(openerIndex, 1)
        closerIndex -= 1
      }
    }
  }
  return settle(nodes)
}

function parseInline<T>(units: Unit<T>[], from: number, to: number): MarkdownInline<T>[] {
  const nodes: Working<T>[] = []
  let text = ''
  let textStart = 0
  const flush = () => {
    if (text) nodes.push({ type: 'text', value: text, start: textStart })
    text = ''
  }
  const append = (value: string, pos: number) => {
    if (!text) textStart = pos
    text += value
  }

  let index = from
  while (index < to) {
    const unit = units[index]!
    if (unit.kind === 'atom') {
      flush()
      nodes.push({ type: 'atom', value: unit.value, atom: unit.atom, start: unit.pos })
      index += 1
      continue
    }
    const next = charAt(units, index + 1)
    if (unit.ch === '\\' && index + 1 < to && next !== null && ESCAPABLE.has(next)) {
      flush()
      nodes.push({ type: 'text', value: next, start: unit.pos })
      index += 2
      continue
    }
    if (unit.ch === '[') {
      const link = readLink(units, index, to)
      if (link) {
        flush()
        nodes.push(link.node)
        index = link.end
        continue
      }
    }
    if (unit.ch === '*' || unit.ch === '_') {
      flush()
      const delimiter = delimiterAt(units, index, to, from)
      nodes.push(delimiter)
      index += delimiter.count
      continue
    }
    append(unit.ch, unit.pos)
    index += 1
  }
  flush()
  return processEmphasis(nodes)
}

function lineString<T>(units: Unit<T>[], from: number, to: number) {
  let value = ''
  for (let index = from; index < to; index += 1) value += charAt(units, index)
  return value
}

type Line = { from: number; to: number; start: number; list: { ordered: boolean; marker: string; contentFrom: number } | null; blank: boolean }

/** Parses a body (already split into text and atoms) into paragraphs-with-newlines and lists. */
export function parseMarkdown<T>(segments: ReadonlyArray<MarkdownSource<T>>): MarkdownBlock<T>[] {
  const units = toUnits(segments)
  const bodyLength = segments.reduce((total, segment) => total + segment.value.length, 0)
  const lines: Line[] = []
  let lineFrom = 0
  let lineStart = 0
  for (let index = 0; index <= units.length; index += 1) {
    const unit = units[index]
    if (unit && !(unit.kind === 'char' && unit.ch === '\n')) continue
    const value = lineString(units, lineFrom, index)
    const bullet = value.match(BULLET)
    const numbered = bullet ? null : value.match(NUMBERED)
    const list = bullet
      ? { ordered: false, marker: '•', contentFrom: lineFrom + bullet[0].length }
      : numbered
        ? { ordered: true, marker: `${numbered[1]}.`, contentFrom: lineFrom + numbered[0].length }
        : null
    lines.push({ from: lineFrom, to: index, start: lineStart, list, blank: !value.trim() })
    lineFrom = index + 1
    lineStart = unit ? unit.pos + 1 : bodyLength
  }

  const blocks: MarkdownBlock<T>[] = []
  let paragraph: { children: MarkdownInline<T>[]; start: number } | null = null
  const flushParagraph = () => {
    if (paragraph?.children.length) blocks.push({ type: 'text', children: settle<T>(paragraph.children), start: paragraph.start })
    paragraph = null
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (!line.list) {
      if (!paragraph) paragraph = { children: [], start: line.start }
      else paragraph.children.push({ type: 'text', value: '\n', start: line.start - 1 })
      paragraph.children.push(...parseInline(units, line.from, line.to))
      index += 1
      continue
    }

    // The newline before a list and the one after it are the list's own line breaks.
    flushParagraph()
    const ordered = line.list.ordered
    const items: MarkdownListItem<T>[] = []
    while (index < lines.length) {
      const current = lines[index]!
      if (current.list?.ordered === ordered) {
        const contentStart = units[current.list.contentFrom]?.pos ?? current.start
        items.push({ marker: current.list.marker, children: parseInline(units, current.list.contentFrom, current.to), start: contentStart })
        index += 1
        continue
      }
      // Blank lines between items of the same list keep the list together.
      let lookahead = index
      while (lookahead < lines.length && lines[lookahead]!.blank && !lines[lookahead]!.list) lookahead += 1
      if (lookahead > index && lines[lookahead]?.list?.ordered === ordered) {
        index = lookahead
        continue
      }
      break
    }
    blocks.push({ type: 'list', ordered, items, start: line.start })
  }
  flushParagraph()
  return blocks
}

function truncateInline<T>(nodes: MarkdownInline<T>[], cut: number): MarkdownInline<T>[] {
  const kept: MarkdownInline<T>[] = []
  for (const node of nodes) {
    if (node.start >= cut) break
    if (node.type === 'text') kept.push({ ...node, value: node.value.slice(0, cut - node.start) })
    else if (node.type === 'strong' || node.type === 'emphasis') {
      const children = truncateInline(node.children, cut)
      if (children.length) kept.push({ ...node, children })
    } else {
      // Mentions, hashtags and links are never split: a link that starts before the cut shows whole.
      kept.push(node)
    }
  }
  return kept
}

/**
 * The blocks that fall before body offset `cut`, with open bold/italic kept open, so a collapsed
 * post shows "Good Mor…" in bold instead of a stray "**Good Mor".
 */
export function truncateMarkdown<T>(blocks: MarkdownBlock<T>[], cut: number): MarkdownBlock<T>[] {
  const kept: MarkdownBlock<T>[] = []
  for (const block of blocks) {
    if (block.start >= cut) break
    if (block.type === 'text') {
      const children = truncateInline(block.children, cut)
      if (children.length) kept.push({ ...block, children })
      continue
    }
    const items = block.items
      .filter((item) => item.start < cut)
      .map((item) => ({ ...item, children: truncateInline(item.children, cut) }))
    if (items.length) kept.push({ ...block, items })
  }
  return kept
}

export type MarkdownFormat = 'bold' | 'italic' | 'bulleted' | 'numbered' | 'link'
export type TextSelection = { value: string; start: number; end: number }

const FORMAT_PLACEHOLDER: Record<'bold' | 'italic' | 'link', string> = { bold: 'bold text', italic: 'italic text', link: 'link text' }
const BULLET_PREFIX = /^ {0,3}[-*][ \t]+/
const NUMBER_PREFIX = /^ {0,3}\d{1,3}\.[ \t]+/

/** Grows a selection that cuts into "@Name" so formatting never splits a mention label. */
function protectAtoms(value: string, start: number, end: number, atoms: readonly string[]) {
  let from = start
  let to = end
  for (const atom of atoms) {
    if (!atom) continue
    for (let index = value.indexOf(atom); index >= 0; index = value.indexOf(atom, index + 1)) {
      const atomEnd = index + atom.length
      if (from > index && from < atomEnd) from = index
      if (to > index && to < atomEnd) to = atomEnd
    }
  }
  return { from, to }
}

function starRun(value: string, index: number, step: 1 | -1) {
  let count = 0
  for (let at = index; at >= 0 && at < value.length && value[at] === '*'; at += step) count += 1
  return count
}

function wrapInline(value: string, start: number, end: number, format: 'bold' | 'italic'): TextSelection {
  const marker = format === 'bold' ? '**' : '*'
  // Spaces just inside the selection stay outside the markers, or "**word **" would not close.
  let from = start
  let to = end
  while (from < to && /\s/.test(value[from]!)) from += 1
  while (to > from && /\s/.test(value[to - 1]!)) to -= 1

  const before = starRun(value, from - 1, -1)
  const after = starRun(value, to, 1)
  const wrapped = format === 'bold' ? before >= 2 && after >= 2 : before % 2 === 1 && after % 2 === 1
  if (wrapped && to > from) {
    const next = value.slice(0, from - marker.length) + value.slice(from, to) + value.slice(to + marker.length)
    return { value: next, start: from - marker.length, end: to - marker.length }
  }

  const selected = value.slice(from, to)
  const innerWrapped = format === 'bold'
    ? selected.length > 4 && selected.startsWith('**') && selected.endsWith('**')
    : selected.length > 2 && /^\*(?!\*)/.test(selected) && /(?<!\*)\*$/.test(selected)
  if (innerWrapped) {
    const inner = selected.slice(marker.length, -marker.length)
    return { value: value.slice(0, from) + inner + value.slice(to), start: from, end: from + inner.length }
  }

  const text = selected || FORMAT_PLACEHOLDER[format]
  return {
    value: `${value.slice(0, from)}${marker}${text}${marker}${value.slice(to)}`,
    start: from + marker.length,
    end: from + marker.length + text.length,
  }
}

function wrapLink(value: string, start: number, end: number): TextSelection {
  const selected = value.slice(start, end).trim()
  if (/^https?:\/\/\S+$/i.test(selected)) {
    const label = FORMAT_PLACEHOLDER.link
    return { value: `${value.slice(0, start)}[${label}](${selected})${value.slice(end)}`, start: start + 1, end: start + 1 + label.length }
  }
  const label = selected || FORMAT_PLACEHOLDER.link
  const target = 'https://'
  const next = `${value.slice(0, start)}[${label}](${target})${value.slice(end)}`
  // Select the label when it is a placeholder, otherwise the URL to type over.
  const targetStart = start + label.length + 3
  return selected ? { value: next, start: targetStart, end: targetStart + target.length } : { value: next, start: start + 1, end: start + 1 + label.length }
}

function toggleList(value: string, start: number, end: number, format: 'bulleted' | 'numbered'): TextSelection {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const endNewline = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end)
  const lineEnd = endNewline < 0 ? value.length : endNewline
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const own = format === 'bulleted' ? BULLET_PREFIX : NUMBER_PREFIX
  const filled = lines.filter((line) => line.trim())
  const remove = filled.length > 0 && filled.every((line) => own.test(line))

  const bareLine = (line: string) => line.replace(BULLET_PREFIX, '').replace(NUMBER_PREFIX, '')
  let number = 0
  const next = lines.map((line) => {
    if (remove) return bareLine(line)
    // Blank lines inside a multi-line selection stay blank; a lone empty line becomes a new item.
    if (!line.trim() && lines.length > 1) return line
    number += 1
    return `${format === 'bulleted' ? '- ' : `${number}. `}${bareLine(line)}`
  })
  const block = next.join('\n')
  const result = value.slice(0, lineStart) + block + value.slice(lineEnd)
  if (start === end && lines.length === 1) {
    // A caret keeps its place in the line's text, after the new prefix.
    const bare = bareLine(lines[0]!).length
    const oldPrefix = lines[0]!.length - bare
    const newPrefix = next[0]!.length - bare
    const caret = Math.max(lineStart + newPrefix, start + newPrefix - oldPrefix)
    return { value: result, start: caret, end: caret }
  }
  return { value: result, start: lineStart, end: lineStart + block.length }
}

/**
 * Round H (H2): applies a composer toolbar format to the textarea text and returns the new text
 * with the selection to restore. Bold and italic wrap (or unwrap) the selection, lists prefix
 * (or un-prefix) every selected line, and links wrap the selection as "[text](https://)".
 * `atoms` are "@Name" labels that must stay whole so the composer keeps its mentions.
 */
export function applyMarkdownFormat(selection: TextSelection, format: MarkdownFormat, atoms: readonly string[] = []): TextSelection {
  const { value } = selection
  const start = Math.max(0, Math.min(selection.start, selection.end, value.length))
  const end = Math.min(value.length, Math.max(selection.start, selection.end))
  const { from, to } = protectAtoms(value, start, end, atoms)
  if (format === 'bulleted' || format === 'numbered') return toggleList(value, from, to, format)
  if (format === 'link') return wrapLink(value, from, to)
  return wrapInline(value, from, to, format)
}
