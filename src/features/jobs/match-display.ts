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
  /** Round G (G3): matching v2 shows the band only, never a raw %. */
  showPercent: boolean
  /** "Not eligible: needs …" when a hard requirement is missing (matching v2). */
  ineligible: string | null
}

/**
 * How a match is shown. Round 12: no badge for null; no % below 40; banded labels above.
 * Round G (matching v2): "Strong / Good / Partial match" with no %, and a not-eligible job always
 * shows "Not eligible: needs …" instead.
 */
export function jobMatchDisplay(match: JobMatchResult | null | undefined): JobMatchDisplay | null {
  if (!match) return null
  const v2 = match.version === 2
  const ineligible = v2 && match.eligible === false ? (match.ineligibleReason ?? 'Not eligible') : null
  if (match.score === null && !ineligible) return null
  const band = match.band ?? matchBand(match.score) ?? 'low'
  const label = BAND_LABELS[band]
  if (ineligible) return { band, label, score: match.score ?? 0, text: ineligible, showInList: true, showPercent: false, ineligible }
  return {
    band,
    label,
    score: match.score ?? 0,
    text: band === 'low' || v2 ? label : `${label} · ${match.score}%`,
    showInList: band !== 'low',
    showPercent: !v2,
    ineligible: null,
  }
}
