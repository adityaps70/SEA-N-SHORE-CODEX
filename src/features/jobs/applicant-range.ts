/**
 * Round H (H7): how many people applied, as a range anyone can see on the job page. The poster
 * sees the exact count in the hiring dashboard. Bands overlap at their edges like the brief's
 * copy ("10–25", "25–50"): each band starts at its lower number.
 */
export function applicantRangeLabel(count: number): string {
  const value = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  if (value === 0) return 'Be among the first applicants'
  if (value < 10) return 'Fewer than 10 applicants'
  if (value < 25) return '10–25 applicants'
  if (value < 50) return '25–50 applicants'
  if (value < 100) return '50–100 applicants'
  return '100+ applicants'
}
