/**
 * Learning round E: a word-level diff for the revision review page, so the owner can see exactly what a draft
 * revision changes in a material's wording (for example the SIRE article conversion, which should change layout
 * and heading case only). Pure, so it is unit-tested without a browser.
 */

export type DiffSegment = { kind: 'same' | 'added' | 'removed'; text: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

/** The readable text of article HTML: tags become breaks or spaces, entities are decoded, whitespace collapses. */
export function articleText(body: string | null | undefined, format: string | null | undefined) {
  if (!body) return ''
  const text = format === 'html'
    ? body
      .replace(/<(br|\/p|\/h[1-6]|\/li|\/tr|\/blockquote|\/figcaption)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name] ?? match)
    : body
  return text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

function tokens(text: string) {
  // Words and line breaks; spaces are rebuilt when the diff is shown.
  return text.split(/(\n)|\s+/).filter((token): token is string => Boolean(token))
}

/**
 * Longest-common-subsequence diff over word tokens. Long texts fall back to a whole-text replace beyond `maxCells`
 * so one huge material can never hang a request.
 */
export function diffWords(before: string, after: string, maxCells = 12_000_000): DiffSegment[] {
  const a = tokens(before)
  const b = tokens(after)
  // Trim the common start and end first: most edits are local.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const head = a.slice(0, start)
  const tail = a.slice(endA)
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)

  const out: DiffSegment[] = []
  const push = (kind: DiffSegment['kind'], token: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += token === '\n' || last.text.endsWith('\n') ? token : ` ${token}`
    else out.push({ kind, text: token })
  }
  head.forEach((token) => push('same', token))

  if ((midA.length + 1) * (midB.length + 1) > maxCells) {
    midA.forEach((token) => push('removed', token))
    midB.forEach((token) => push('added', token))
  } else {
    const width = midB.length + 1
    const table = new Uint32Array((midA.length + 1) * width)
    for (let i = midA.length - 1; i >= 0; i -= 1) {
      for (let j = midB.length - 1; j >= 0; j -= 1) {
        table[i * width + j] = midA[i] === midB[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        push('same', midA[i]!)
        i += 1
        j += 1
      } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
        push('removed', midA[i]!)
        i += 1
      } else {
        push('added', midB[j]!)
        j += 1
      }
    }
    while (i < midA.length) push('removed', midA[i++]!)
    while (j < midB.length) push('added', midB[j++]!)
  }

  tail.forEach((token) => push('same', token))
  return out
}

/** True when two texts have the same words ignoring letter case and line breaks (e.g. a heading made Title Case). */
export function sameWordsIgnoringCase(before: string, after: string) {
  // List markers ("- ", "• ", "* ") are layout, not words.
  const normalise = (text: string) => tokens(text).filter((token) => token !== '\n' && token !== '•' && token !== '-' && token !== '*').join(' ').toLowerCase()
  return normalise(before) === normalise(after)
}
