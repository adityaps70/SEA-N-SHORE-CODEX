import { normaliseLegacyRank, normaliseRoleText, roleByKey } from './taxonomy'

/**
 * P6 (owner-approved 13 Nov): which old typed "Other" ranks on jobs clearly name existing ranks. A text matches when
 * all of it, or every part of it split at ";", ",", "&", "+", "and", "or" or "/", is a rank's name, a synonym, or one
 * of the common abbreviations below. "Master/ Chief officer" → Master + Chief Officer; "C/O" stays Chief Officer.
 * Anything else is unclear and stays as typed. The runner's preview (scripts/aws/p6-other-ranks-preview.py) uses the
 * same lookup (other-rank-lookup.json, generated from this file) and the same steps, kept equal by a test.
 */
export const OTHER_RANK_ABBREVIATIONS: Readonly<Record<string, string>> = {
  'ch off': 'chief_officer',
  'ch offr': 'chief_officer',
  'c off': 'chief_officer',
  'ch mate': 'chief_officer',
  'capt': 'master',
  'cpt': 'master',
  'ch eng': 'chief_engineer',
  'ch engr': 'chief_engineer',
  'ch engg': 'chief_engineer',
  '2 e': 'second_engineer',
  '2nd engr': 'second_engineer',
  '3 e': 'third_engineer',
  '3rd engr': 'third_engineer',
  '4 e': 'fourth_engineer',
  '4th engr': 'fourth_engineer',
  '2 o': 'second_officer',
  '3 o': 'third_officer',
}

/** The separators tried in this order; "/" last, so "C/O and 2/O" splits at "and" before "/". */
export const OTHER_RANK_SEPARATORS = [';', ',', '&', '+', ' and ', ' or ', '/'] as const

function lookup(text: string): string | null {
  const normalised = normaliseRoleText(text)
  if (!normalised) return null
  const key = normaliseLegacyRank(text) ?? OTHER_RANK_ABBREVIATIONS[normalised] ?? null
  return key && roleByKey(key) && !roleByKey(key)?.other ? key : null
}

/** The existing ranks a typed text clearly names, in order, or null when it is unclear. */
export function matchOtherRankText(text: string | null | undefined): string[] | null {
  if (!text || !text.trim()) return null
  return matchPart(text.toLocaleLowerCase('en'), 0)
}

function matchPart(text: string, depth: number): string[] | null {
  const whole = lookup(text)
  if (whole) return [whole]
  if (depth > 3) return null
  for (const separator of OTHER_RANK_SEPARATORS) {
    if (!text.includes(separator)) continue
    const parts = text.split(separator).map((part) => part.trim()).filter(Boolean)
    if (parts.length < 2) continue
    const keys: string[] = []
    for (const part of parts) {
      const matched = matchPart(part, depth + 1)
      if (!matched) return null
      keys.push(...matched)
    }
    return [...new Set(keys)]
  }
  return null
}
