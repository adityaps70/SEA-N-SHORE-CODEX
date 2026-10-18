import { roleByKey } from '@/features/roles/taxonomy'
import type { JobMatchCheck } from './types'

/**
 * Round H (H7): "Check before applying" items, each saying what the job requires and what the
 * profile has. Built next to the matching strings (missingRequirements / warnings), which stay
 * for the callers that show one line (cards, apply gate).
 */

function dateLabel(value: string | Date | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

/** 3 → "3 years", 1 → "1 year", 2.46 → "2.5 years". */
export function yearsLabel(years: number) {
  const rounded = Math.round(years * 10) / 10
  return `${rounded} ${rounded === 1 ? 'year' : 'years'}`
}

function listOr(values: readonly string[], empty: string) {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  return unique.length ? unique.join(', ') : empty
}

export function rankCheck(required: string, memberRoleKeys: readonly string[], note?: string): JobMatchCheck {
  const labels = memberRoleKeys.map((key) => roleByKey(key)?.label ?? key)
  const yours = labels.length ? `${labels.join(' / ')}${note ? ` (${note})` : ''}` : 'No rank or role on your profile'
  return { key: 'rank', label: 'Rank / role', required, yours }
}

export function roleExperienceCheck(title: string): JobMatchCheck {
  return { key: 'rank', label: 'Experience', required: `Experience as ${title}`, yours: 'Not found in your experience, skills or headline' }
}

export function experienceCheck(minYears: number, years: number | null, seaJob: boolean): JobMatchCheck {
  return {
    key: 'experience',
    label: seaJob ? 'Sea time' : 'Experience',
    required: `${Math.round(minYears * 10) / 10}+ years`,
    yours: years === null ? 'Not on your profile' : yearsLabel(years),
  }
}

export function vesselCheck(jobVessels: readonly string[], memberVessels: readonly string[]): JobMatchCheck {
  return { key: 'vessel', label: 'Vessel type', required: jobVessels.join(' or '), yours: listOr(memberVessels, 'None on your profile') }
}

export type CertificateCheckState =
  | { state: 'missing'; related?: readonly string[] }
  | { state: 'expired'; expiresAt: string | null }
  | { state: 'self_reported' }

export function certificateCheck(name: string, detail: CertificateCheckState): JobMatchCheck {
  const yours = detail.state === 'missing'
    ? listOr(detail.related ?? [], 'Not on your profile')
    : detail.state === 'expired'
      ? (dateLabel(detail.expiresAt) ? `Expired on ${dateLabel(detail.expiresAt)}` : 'Expired')
      : 'Self-reported, not yet verified'
  return { key: 'certificate', label: 'Certificate', required: detail.state === 'self_reported' ? `${name} (verified)` : name, yours }
}

export function visaCheck(visa: string, memberVisas: readonly string[]): JobMatchCheck {
  return { key: 'visa', label: 'Visa', required: visa, yours: listOr(memberVisas, 'No visas on your profile') }
}

export function availabilityCheck(joinBy: Date, availableFrom: Date): JobMatchCheck {
  return { key: 'availability', label: 'Availability', required: `Join by ${dateLabel(joinBy)}`, yours: `Available from ${dateLabel(availableFrom)}` }
}

/** Adds a check unless the same label and requirement is already listed. */
export function pushCheck(target: JobMatchCheck[], check: JobMatchCheck) {
  if (!target.some((item) => item.label === check.label && item.required === check.required)) target.push(check)
}
