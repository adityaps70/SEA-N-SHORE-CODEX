import { TriangleAlert } from 'lucide-react'
import type { JobMatchCheck, JobMatchResult } from '../types'

type CheckItem = { id: string; check: JobMatchCheck | null; text: string }

/**
 * Round H (H7): the "Check before applying" items: each explained check (what is required, what the
 * profile has), or the plain strings for a match without them.
 */
export function matchCheckItems(match: Pick<JobMatchResult, 'checks' | 'missingRequirements' | 'warnings'>): CheckItem[] {
  if (match.checks?.length) {
    return match.checks.map((check) => ({ id: `${check.label}|${check.required}`, check, text: `${check.label}: ${check.required}` }))
  }
  return [...new Set([...match.missingRequirements, ...match.warnings])].map((text) => ({ id: text, check: null, text }))
}

export function JobMatchChecks({ match, textClassName = 'text-sm leading-6' }: { match: Pick<JobMatchResult, 'checks' | 'missingRequirements' | 'warnings'>; textClassName?: string }) {
  const items = matchCheckItems(match)
  if (!items.length) return <p className="mt-2 text-sm font-medium text-emerald-800">No major profile gaps detected.</p>
  return (
    <ul className="mt-3 space-y-3">
      {items.map(({ id, check, text }) => (
        <li key={id} className={`flex items-start gap-2 text-amber-900 ${textClassName}`}>
          <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
          {check ? (
            <span className="min-w-0">
              <span className="block font-semibold">{check.label}</span>
              <span className="block break-words text-ink">Required: {check.required}</span>
              <span className="block break-words text-ink">Your profile: {check.yours}</span>
            </span>
          ) : <span className="min-w-0 break-words">{text}</span>}
        </li>
      ))}
    </ul>
  )
}
