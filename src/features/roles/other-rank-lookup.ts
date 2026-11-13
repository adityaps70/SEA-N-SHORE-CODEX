import { OTHER_RANK_ABBREVIATIONS, OTHER_RANK_SEPARATORS } from './other-rank-matcher'
import { legacyRankLookupEntries, roleByKey } from './taxonomy'

/** P6: everything the Python preview needs to match typed ranks exactly as matchOtherRankText does. */
export function otherRankLookupFile() {
  const lookup: Record<string, string> = {}
  for (const [text, key] of legacyRankLookupEntries()) if (!roleByKey(key)?.other) lookup[text] = key
  for (const [text, key] of Object.entries(OTHER_RANK_ABBREVIATIONS)) if (!(text in lookup)) lookup[text] = key
  return { generatedBy: 'scripts/generate-other-rank-lookup.ts', separators: [...OTHER_RANK_SEPARATORS], lookup }
}
