import { matchBand } from './matching'
import type { JobMatchBand, JobMatchResult } from './types'

const BAND_LABELS: Record<JobMatchBand, string> = {
  low: 'Low match',
  partial: 'Partial match',
  good: 'Good match',
  strong: 'Strong match',
}

export type JobMatchDisplay = {
  band: JobMatchBand
  /** "Low match", "Partial match", "Good match" or "Strong match". */
  label: string
  score: number
  /** "Good match · 68%"; just "Low match" below 40. */
  text: string
  /** Lists show a badge from 40%; below that the job page says "Low match" and what is missing. */
  showInList: boolean
}

/** How a match is shown (round 12): no badge for null; no % below 40; banded labels above. */
export function jobMatchDisplay(match: JobMatchResult | null | undefined): JobMatchDisplay | null {
  if (!match || match.score === null) return null
  const band = match.band ?? matchBand(match.score)
  if (!band) return null
  const label = BAND_LABELS[band]
  return {
    band,
    label,
    score: match.score,
    text: band === 'low' ? label : `${label} · ${match.score}%`,
    showInList: band !== 'low',
  }
}
