import type { GroupSuggestionSignals } from './types'

/** Slugs of the launch groups seeded by migration 0055. */
export const SUGGESTION_FALLBACK_SLUG = 'ask-the-community'

const SENIOR_RANK_PATTERN = /\b(master|captain|chief officer|chief mate|c\/o|2nd officer|second officer|2\/o|3rd officer|third officer|3\/o|staff captain|deck officer)\b/i

/**
 * Deterministic group suggestions from the member's rank, vessel types and persona. Pure: the
 * caller loads the signals and removes the groups the member already belongs to.
 *
 * - rank mentions "engineer" → marine-engineers
 * - command and deck-officer ranks → masters-senior-officers
 * - a tanker vessel type → tanker-professionals
 * - the student / cadet persona → cadets-community
 * - ask-the-community is always suggested last as the fallback
 */
export function suggestedGroupSlugs(signals: GroupSuggestionSignals, excludeSlugs: Iterable<string> = []): string[] {
  const slugs: string[] = []
  const rank = signals.rank?.trim() ?? ''
  if (/engineer/i.test(rank)) slugs.push('marine-engineers')
  if (SENIOR_RANK_PATTERN.test(rank)) slugs.push('masters-senior-officers')
  if (signals.vesselTypes.some((type) => /tanker/i.test(type))) slugs.push('tanker-professionals')
  if (signals.persona === 'student_cadet' || /\bcadet\b/i.test(rank)) slugs.push('cadets-community')
  slugs.push(SUGGESTION_FALLBACK_SLUG)
  const excluded = new Set(excludeSlugs)
  return [...new Set(slugs)].filter((slug) => !excluded.has(slug))
}
