import Link from 'next/link'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import type { ApplyGate } from '../apply-gate'

/**
 * Why the member cannot apply yet (round 12): a sea role for another profile type, the profile items
 * the job needs (each opening its in-place editor on My Profile), or a match below the job's minimum.
 */
export function ApplyGateNotice({ gate, className = '' }: { gate: ApplyGate; className?: string }) {
  if (gate.status === 'open') return null
  return (
    <div role="status" data-apply-gate={gate.status} className={`rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 ${className}`}>
      <p className="flex items-start gap-2 font-semibold">
        <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
        <span>{gate.message}</span>
      </p>
      {gate.status === 'sea_job_profile_type' ? (
        <Link href={gate.href} className="mt-2 inline-flex items-center gap-1 font-semibold text-ocean-800 underline-offset-2 hover:underline">
          Update your profile type <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
      {gate.status === 'incomplete' ? (
        <>
          <ul className="mt-2 space-y-1">
            {gate.gaps.map((gap) => (
              <li key={gap.key}>
                <Link href={gap.href} className="inline-flex items-center gap-1 font-semibold text-ocean-800 underline-offset-2 hover:underline">
                  {gap.label} <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">Come back to this job after saving to check again.</p>
        </>
      ) : null}
      {gate.status === 'below_minimum' && gate.missing.length ? (
        <p className="mt-1 text-amber-800">Missing: {gate.missing.join(', ')}</p>
      ) : null}
    </div>
  )
}
