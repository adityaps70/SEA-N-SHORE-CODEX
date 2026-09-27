/**
 * Splits a long course description into a short introduction and the rest, so the
 * course hero stays readable. Short descriptions are returned whole.
 */
export function splitDescription(text: string, limit = 480): [string, string] {
  const value = text.trim()
  if (value.length <= limit) return [value, '']
  const sentenceEnd = value.indexOf('. ', 280)
  const cut = sentenceEnd > 0 && sentenceEnd < limit + 160 ? sentenceEnd + 1 : value.lastIndexOf(' ', limit)
  if (cut <= 0) return [value, '']
  return [value.slice(0, cut).trim(), value.slice(cut).trim()]
}
