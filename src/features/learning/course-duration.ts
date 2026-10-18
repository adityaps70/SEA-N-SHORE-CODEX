/**
 * Round H (H7): a course's total length from its material durations, e.g. "6 h 30 min", "2 h" or "45 min".
 * Rounded to the nearest minute; null for no duration, so the fact is hidden.
 */
export function formatCourseDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null
  const minutes = Math.max(1, Math.round(seconds / 60))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} min`
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}
