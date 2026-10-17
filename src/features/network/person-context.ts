function normalised(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

/** Whole-word containment: "Chief Engineer" is in "Chief Engineer | LNG", "Engineer" is not in "Engineering". */
function containsPhrase(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text)
}

/**
 * Round H (H7): the "rank · organization · location" line under a person's headline, without repeating what the
 * headline already says. A headline of "Chief Engineer" with the rank Chief Engineer shows the rank once.
 */
export function personContextParts(profile: {
  headline?: string | null
  rank?: string | null
  currentCompany?: string | null
  location?: string | null
}, fields: ReadonlyArray<'rank' | 'currentCompany' | 'location'> = ['rank', 'currentCompany', 'location']) {
  const headline = profile.headline ? normalised(profile.headline) : ''
  const seen = new Set<string>()
  return fields.flatMap((field) => {
    const value = profile[field]?.trim()
    if (!value) return []
    const key = normalised(value)
    if (seen.has(key) || ((field === 'rank' || field === 'currentCompany') && containsPhrase(headline, key))) return []
    seen.add(key)
    return [value]
  })
}
