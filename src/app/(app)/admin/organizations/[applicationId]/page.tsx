import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Building2, ExternalLink, UserRound } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { adminRepository } from '@/features/admin/repository'
import { OrganizationReviewActions } from '@/features/admin/components/organization-review-actions'

function valueOrDash(value: string | null | undefined) {
  return value?.trim() || '—'
}

function dateLabel(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-[0.13em] text-muted">{label}</dt>
      <dd className="mt-1 text-sm leading-6 text-navy-950">{value}</dd>
    </div>
  )
}

export default async function AdminOrganizationReviewPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params
  if (!z.string().uuid().safeParse(applicationId).success) notFound()

  const user = await requireAwsUser()
  const review = await adminRepository.getOrganizationApplicationReview(user.id, applicationId)
  if (!review) notFound()

  return (
    <main className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/admin/organizations" className="text-sm font-bold text-muted hover:text-navy-950">← Organization reviews</Link>
          <h2 className="mt-2 text-3xl font-bold text-navy-950">{review.company.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full bg-mist-50 px-2.5 py-1 text-muted">{review.status.replaceAll('_', ' ')}</span>
            {review.company.verified ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">Verified employer</span> : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">Not verified</span>}
          </div>
        </div>
        <p className="text-sm text-muted">Submitted {dateLabel(review.submittedAt)}</p>
      </div>

      <section className="grid gap-5 lg:grid-cols-[1.35fr_0.85fr]">
        <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-mist-50 text-navy-950"><Building2 aria-hidden="true" className="size-5" /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Employer record</p>
              <h3 className="text-xl font-bold text-navy-950">Organization information</h3>
            </div>
          </div>

          <dl className="mt-6 grid gap-5 sm:grid-cols-2">
            <Detail label="Organization type" value={valueOrDash(review.company.type)} />
            <Detail label="Website" value={valueOrDash(review.company.website)} />
            <Detail label="Official company email" value={review.officialEmail} />
            <Detail label="Registration / reference" value={valueOrDash(review.registrationReference)} />
            <Detail label="Fleet summary" value={valueOrDash(review.company.fleetSummary)} />
            <Detail label="Vessel types" value={review.company.vesselTypes.length ? review.company.vesselTypes.join(', ') : '—'} />
            <Detail label="Office locations" value={review.company.officeLocations.length ? review.company.officeLocations.join(', ') : '—'} />
            <Detail label="Last updated" value={dateLabel(review.updatedAt)} />
          </dl>

          <div className="mt-6 border-t border-mist-100 pt-5">
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-muted">Description</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-navy-950">{valueOrDash(review.company.description)}</p>
          </div>

          <div className="mt-5 border-t border-mist-100 pt-5">
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-muted">Supporting notes</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-navy-950">{valueOrDash(review.supportingNotes)}</p>
          </div>
        </article>

        <div className="space-y-5">
          <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-mist-50 text-navy-950"><UserRound aria-hidden="true" className="size-5" /></span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Applicant</p>
                <h3 className="text-lg font-bold text-navy-950">{review.applicant.fullName}</h3>
              </div>
            </div>
            <dl className="mt-5 space-y-4">
              <Detail label="Applicant relationship" value={review.applicantRole} />
              <Detail label="Profile headline" value={valueOrDash(review.applicant.headline)} />
              <Detail label="Requested membership" value={valueOrDash(review.applicant.membershipRole)} />
              <Detail label="Membership approved" value={dateLabel(review.applicant.membershipApprovedAt)} />
            </dl>
            {review.applicant.slug ? (
              <Link href={`/people/${review.applicant.slug}`} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-navy-950 hover:underline">
                View member profile <ExternalLink aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
          </article>

          {review.adminReviewNote ? (
            <article className="rounded-[1.5rem] border border-amber-100 bg-amber-50 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.13em] text-amber-800">Previous reviewer note</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-950">{review.adminReviewNote}</p>
              <p className="mt-3 text-xs text-amber-800">Reviewed {dateLabel(review.reviewedAt)}</p>
            </article>
          ) : null}
        </div>
      </section>

      <OrganizationReviewActions applicationId={review.applicationId} status={review.status} />
    </main>
  )
}
