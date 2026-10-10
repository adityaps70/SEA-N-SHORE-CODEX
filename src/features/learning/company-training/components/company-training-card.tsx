import Link from 'next/link'
import { ArrowRight, Building2 } from 'lucide-react'
import type { MemberInvitation, MemberSharing } from '../crew-repository'
import { StopSharingButton } from './training-controls'

/**
 * D3, My Learning: open crew training invitations, and the companies the member shares assigned-course progress with
 * (with "Stop sharing"). Shown only when there is something to show.
 */
export function CompanyTrainingCard({ invitations, sharing }: { invitations: MemberInvitation[]; sharing: MemberSharing[] }) {
  const active = sharing.filter((entry) => entry.status === 'active')
  const stopped = sharing.filter((entry) => entry.status === 'withdrawn')
  if (!invitations.length && !active.length && !stopped.length) return null
  return (
    <section aria-labelledby="company-training-heading" className="mt-5 rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:mx-4 max-md:mt-3 max-md:p-4">
      <h2 id="company-training-heading" className="flex items-center gap-2 text-base font-bold text-navy-950">
        <Building2 aria-hidden="true" className="size-4 text-ocean-700" /> Crew training
      </h2>
      {invitations.length ? (
        <ul className="mt-3 grid gap-2">
          {invitations.map((invitation) => (
            <li key={invitation.id}>
              <Link
                href={`/learn/company-invitations/${invitation.id}`}
                className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-ocean-200 bg-ocean-50 px-4 py-2.5 text-sm transition hover:bg-ocean-100"
              >
                <span className="min-w-0">
                  <span className="block font-bold text-navy-950">{invitation.companyName} invited you to its crew training</span>
                  <span className="block text-xs text-navy-900">Review what it would see, then accept or decline</span>
                </span>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {active.length || stopped.length ? (
        <ul className="mt-3 divide-y divide-mist-100">
          {[...active, ...stopped].map((entry) => (
            <li key={entry.companyId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 text-sm">
                <span className="block font-semibold text-navy-950">{entry.companyName}</span>
                <span className="block text-xs text-muted">
                  {entry.status === 'active'
                    ? `Sees your progress and certificates for ${entry.courses} assigned ${entry.courses === 1 ? 'course' : 'courses'}, and nothing else`
                    : 'You stopped sharing. It sees only that its seats are in use.'}
                </span>
              </span>
              {entry.status === 'active' ? <StopSharingButton companyId={entry.companyId} companyName={entry.companyName} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
