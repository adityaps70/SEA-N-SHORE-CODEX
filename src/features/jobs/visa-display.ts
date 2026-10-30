/**
 * Hotfix P5: visa is information only. Members and job posters often type "N/A", "NA", "none", "nil",
 * "-" or "not applicable" in a visa field; those mean "no visa listed" and are never shown.
 */
const PLACEHOLDERS = new Set(['', 'na', 'none', 'nil', 'notapplicable'])

/** True for an empty or "N/A"-style value, in any case or spacing ("n / a", " N.A. ", "--"). */
export function isPlaceholderVisa(value: string | null | undefined): boolean {
  return PLACEHOLDERS.has((value ?? '').toLowerCase().replace(/[\s./_-]+/g, ''))
}

/** The visa values worth showing, trimmed, without placeholders or repeats. */
export function displayableVisas(values: readonly (string | null | undefined)[]): string[] {
  const shown: string[] = []
  for (const value of values) {
    const trimmed = (value ?? '').trim()
    if (isPlaceholderVisa(trimmed)) continue
    if (!shown.some((item) => item.toLowerCase() === trimmed.toLowerCase())) shown.push(trimmed)
  }
  return shown
}

/** A job's visa / documents note: every listed visa (required or preferred), placeholders left out. */
export function jobVisaNote(job: { visaRequirements: readonly string[]; visaList?: ReadonlyArray<{ name: string }> }): string[] {
  return displayableVisas(job.visaList?.length ? job.visaList.map((item) => item.name) : job.visaRequirements)
}
