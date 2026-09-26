/** "1 year", "1.5 years", "12 years" — never "1 years". */
export function formatYears(value: number | string | null | undefined, fallback = 'Not listed') {
  if (value === null || value === undefined || value === '') return fallback
  const years = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(years)) return fallback
  return `${years} ${years === 1 ? 'year' : 'years'}`
}

/** Pluralises a count with its noun: pluralize(1, 'result') → "1 result". */
export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}
