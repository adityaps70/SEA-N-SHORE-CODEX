/**
 * Round G (G4): split a result name into plain and matched parts for <mark>. A part matches when a
 * word of the name starts with a word of the query (case and accent of punctuation ignored).
 */
export type HighlightPart = { text: string; match: boolean }

export function highlightParts(text: string, query: string): HighlightPart[] {
  const tokens = query.toLocaleLowerCase('en').split(/[^a-z0-9]+/).filter(Boolean)
  if (!tokens.length || !text) return [{ text, match: false }]
  const parts: HighlightPart[] = []
  const pattern = /[A-Za-z0-9]+|[^A-Za-z0-9]+/g
  for (const piece of text.match(pattern) ?? []) {
    const lower = piece.toLocaleLowerCase('en')
    const token = tokens.filter((candidate) => lower.startsWith(candidate)).sort((left, right) => right.length - left.length)[0]
    if (token) {
      parts.push({ text: piece.slice(0, token.length), match: true })
      if (piece.length > token.length) parts.push({ text: piece.slice(token.length), match: false })
    } else {
      parts.push({ text: piece, match: false })
    }
  }
  return parts
}
