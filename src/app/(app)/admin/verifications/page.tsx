import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  CREATOR_VERIFICATION_STATUSES,
  type CreatorVerificationStatus,
  type CreatorVerificationType,
} from '@/features/verifications/application'
import { creatorVerificationRepository } from '@/features/verifications/repository'
import { CreatorVerificationReviewActions } from '@/features/verifications/components/creator-verification-review-actions'
import { formatYears } from '@/lib/format'

export const metadata: Metadata = { title: 'Verifications · Admin' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function readStatus(value: string | string[] | undefined): CreatorVerificationStatus {
  const candidate = Array.isArray(value) ? value[0] : value
  return CREATOR_VERIFICATION_STATUSES.includes(candidate as CreatorVerificationStatus)
    ? candidate as CreatorVerificationStatus
    : 'pending'
}

function readType(value: string | string[] | undefined): CreatorVerificationType | undefined {
  const candidate = Array.isArray(value) ? value[0] : value
  if (candidate === 'recruiter' || candidate === 'event_host') return candidate
  return undefined
}

function typeLabel(type: CreatorVerificationType) {
  return type === 'recruiter' ? 'Recruiter' : 'Event Host'
}

function statusLabel(status: CreatorVerificationStatus) {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  if (status === 'suspended') return 'Suspended'
  return 'Pending'
}

export default async function AdminCreatorVerificationsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const status = readStatus(params.status)
  const type = readType(params.type)
  const user = await requireAwsUser()
  const applications = await creatorVerificationRepository.listAdminApplications(user.id, status, type)

  return (
    <main className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Professional trust</p>
        <h1 className="mt-1 text-2xl font-bold text-navy-950">Creator verification applications</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Review Recruiter and Event Host evidence independently. Approval verifies professional trust only; it does not activate Creator Pro or grant a paid publishing entitlement.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {CREATOR_VERIFICATION_STATUSES.map((item) => (
            <Link
              key={item}
              href={`/admin/verifications?status=${item}${type ? `&type=${type}` : ''}`}
              className={`rounded-full px-3 py-2 text-sm font-bold ${
                item === status ? 'bg-navy-950 text-white' : 'bg-mist-50 text-navy-900'
              }`}
            >
              {statusLabel(item)}
            </Link>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/admin/verifications?status=${status}`}
            className={`rounded-full border px-3 py-2 text-xs font-bold ${
              !type ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-mist-100 text-muted'
            }`}
          >
            All types
          </Link>
          <Link
            href={`/admin/verifications?status=${status}&type=recruiter`}
            className={`rounded-full border px-3 py-2 text-xs font-bold ${
              type === 'recruiter' ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-mist-100 text-muted'
            }`}
          >
            Recruiter
          </Link>
          <Link
            href={`/admin/verifications?status=${status}&type=event_host`}
            className={`rounded-full border px-3 py-2 text-xs font-bold ${
              type === 'event_host' ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-mist-100 text-muted'
            }`}
          >
            Event Host
          </Link>
        </div>
      </section>

      <section className="grid gap-4">
        {applications.map((application) => (
          <article
            key={application.id}
            className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6"
          >
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-navy-950">{application.applicant.fullName}</h2>
                  <span className="rounded-full bg-ocean-50 px-2.5 py-1 text-xs font-bold text-ocean-800">
                    {typeLabel(application.type)}
                  </span>
                  <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold text-muted">
                    {statusLabel(application.status)}
                  </span>
                </div>
                {application.applicant.headline ? <p className="mt-1 text-sm text-muted">{application.applicant.headline}</p> : null}

                {application.application ? (
                  <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-bold uppercase tracking-wide text-muted">Professional role</dt>
                      <dd className="mt-1 font-semibold text-navy-950">{application.application.professionalRole}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-bold uppercase tracking-wide text-muted">Experience</dt>
                      <dd className="mt-1 font-semibold text-navy-950">{formatYears(application.application.experienceYears)}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-bold uppercase tracking-wide text-muted">Organization</dt>
                      <dd className="mt-1 text-navy-900">{application.application.organizationName ?? 'Independent / not supplied'}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-bold uppercase tracking-wide text-muted">Focus areas</dt>
                      <dd className="mt-1 text-navy-900">{application.application.specializations.join(', ')}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-bold uppercase tracking-wide text-muted">Experience summary</dt>
                      <dd className="mt-1 whitespace-pre-wrap leading-6 text-navy-900">{application.application.experienceSummary}</dd>
                    </div>
                    {application.application.evidenceUrl ? (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-bold uppercase tracking-wide text-muted">Evidence</dt>
                        <dd className="mt-1">
                          <a
                            href={application.application.evidenceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-teal-700 hover:underline"
                          >
                            Open public evidence ↗
                          </a>
                        </dd>
                      </div>
                    ) : null}
                    {application.application.additionalNote ? (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-bold uppercase tracking-wide text-muted">Additional note</dt>
                        <dd className="mt-1 leading-6 text-navy-900">{application.application.additionalNote}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <p className="mt-5 rounded-xl bg-mist-50 p-4 text-sm text-muted">
                    This verification came from a legacy/admin trust source and does not contain a user application payload.
                  </p>
                )}

                {application.reviewNote ? (
                  <p className="mt-4 rounded-xl bg-mist-50 p-4 text-sm leading-6 text-navy-900">
                    <strong>Review note:</strong> {application.reviewNote}
                  </p>
                ) : null}
              </div>

              <div>
                {application.status === 'pending' ? (
                  <CreatorVerificationReviewActions verificationId={application.id} />
                ) : (
                  <div className="rounded-xl bg-mist-50 p-4 text-sm text-muted">
                    This application has already been reviewed.
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}

        {applications.length === 0 ? (
          <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center">
            <p className="font-bold text-navy-950">No {statusLabel(status).toLowerCase()} verification applications.</p>
            <p className="mt-1 text-sm text-muted">Choose another status or verification type to inspect the queue.</p>
          </section>
        ) : null}
      </section>
    </main>
  )
}
