import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminPageHeader } from '@/features/admin/components/admin-ui'
import { ExternalLink } from 'lucide-react'
import {
  learningAdminRepository,
  type MentorApplicationReviewItem,
} from '@/features/learning/admin-repository'
import type { MentorApplicationStatus } from '@/features/learning/mentor-application'
import { MentorReviewControls } from '@/features/learning/components/mentor-review-controls'
import { formatYears } from '@/lib/format'
import { requireAdminAccess } from '@/features/admin/admin-access'
import { PendingCourseReviewsPanel } from '@/features/admin/components/pending-course-reviews-panel'
import { CourseReviewRepliesPanel } from '@/features/admin/components/course-review-replies-panel'
import { allows } from '@/features/country-admins/sections'
import { courseRatingRepository } from '@/features/learning/course-rating-repository'

export const metadata: Metadata = { title: 'Learning review · Admin' }

const statusFilters: Array<{ value: MentorApplicationStatus; label: string }> = [
  { value: 'pending', label: 'Pending review' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

function selectedStatus(value: string | string[] | undefined): MentorApplicationStatus {
  const normalized = Array.isArray(value) ? value[0] : value
  if (normalized === 'pending' || normalized === 'changes_requested' || normalized === 'approved' || normalized === 'rejected') {
    return normalized
  }
  return 'pending'
}

function statusLabel(status: MentorApplicationStatus) {
  return statusFilters.find((filter) => filter.value === status)?.label ?? status
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-mist-100 bg-mist-50 px-2.5 py-1 text-xs font-semibold text-navy-900">{children}</span>
}

function ApplicationCard({ application, canDecide }: { application: MentorApplicationReviewItem; canDecide: boolean }) {
  return (
    <article className="rounded-xl border border-mist-100 bg-white p-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800">{statusLabel(application.status)}</span>
            <span className="text-xs font-semibold text-muted">Submitted {new Date(application.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
          <h2 className="mt-3 text-xl font-bold text-navy-950">{application.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-muted">
            <span>{application.currentLastRank}</span>
            <span aria-hidden="true">•</span>
            <span>{formatYears(application.yearsExperience)}</span>
            {application.vesselTypes.length ? (
              <>
                <span aria-hidden="true">•</span>
                <span>{application.vesselTypes.join(' · ')}</span>
              </>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-mist-100 bg-mist-50/70 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Specialization</p>
              <p className="mt-2 text-sm leading-6 text-navy-900">{application.specialization}</p>
            </section>
            <section className="rounded-2xl border border-mist-100 bg-mist-50/70 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Professional bio</p>
              <p className="mt-2 text-sm leading-6 text-navy-900">{application.shortBio}</p>
            </section>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Certifications</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {application.certifications.length
                  ? application.certifications.map((certification) => <Chip key={certification}>{certification}</Chip>)
                  : <span className="text-sm text-muted">No certifications listed.</span>}
              </div>
            </section>
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Proposed course topics</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {application.proposedCourseTopics.length
                  ? application.proposedCourseTopics.map((topic) => <Chip key={topic}>{topic}</Chip>)
                  : <span className="text-sm text-muted">No topics listed.</span>}
              </div>
            </section>
          </div>

          {application.linkedInUrl ? (
            <a
              href={application.linkedInUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-teal-700 transition hover:text-teal-800"
            >
              Review LinkedIn profile <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}

          {application.adminReviewNote ? (
            <div className="mt-5 rounded-2xl border border-mist-100 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Administrator review note</p>
              <p className="mt-2 text-sm leading-6 text-navy-900">{application.adminReviewNote}</p>
            </div>
          ) : null}
        </div>

        {application.status === 'pending' ? (
          <div className="w-full shrink-0 xl:w-[22rem]">
            {canDecide ? <MentorReviewControls applicationId={application.applicationId} /> : <p className="text-xs font-semibold text-muted">View only: decisions are not part of your country admin access.</p>}
          </div>
        ) : null}
      </div>
    </article>
  )
}

export default async function LearningAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>
}) {
  // Round GP Part E: country admins with Learning see their countries' trainer applications, course ratings and owner
  // replies here (platform administrators also have them on Moderation); decisions need "act".
  const access = await requireAdminAccess('learning')
  const user = access.user
  const canDecide = access.kind === 'platform' || allows(access.permissions, 'learning', 'act')
  const params = await searchParams
  const status = selectedStatus(params.status)
  const [applications, pendingReviews, reviewReplies] = await Promise.all([
    learningAdminRepository.listMentorApplications(user.id, status),
    access.kind === 'country' ? courseRatingRepository.listPendingReviews(user.id) : Promise.resolve([]),
    access.kind === 'country' ? courseRatingRepository.listReviewReplies(user.id) : Promise.resolve([]),
  ])

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Learning review"
        meta={`${applications.length} ${applications.length === 1 ? 'application' : 'applications'} · ${statusLabel(status).toLowerCase()}`}
        description="Approve maritime professionals before they can teach. Every course still gets its own quality review before it is published."
      />

      <nav aria-label="Learning administration" className="flex gap-1 border-b border-mist-100 text-sm font-semibold">
        <Link href="/admin/learning" aria-current="page" className="-mb-px border-b-2 border-ocean-700 px-3 py-2 text-ocean-800">
          Trainer verifications
        </Link>
        <Link href="/admin/learning/courses" className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted transition hover:border-mist-300 hover:text-navy-950">
          Course review
        </Link>
        {/* Learning analytics covers every course, so it stays with platform administrators. */}
        {access.kind === 'platform' ? (
          <Link href="/admin/learning/analytics" className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted transition hover:border-mist-300 hover:text-navy-950">
            Analytics
          </Link>
        ) : null}
      </nav>

      <nav aria-label="Trainer application status" className="flex flex-wrap gap-1.5">
        {statusFilters.map((filter) => (
          <Link
            key={filter.value}
            href={`/admin/learning?status=${filter.value}`}
            aria-current={status === filter.value ? 'page' : undefined}
            className={`inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-semibold transition ${status === filter.value ? 'border-navy-950 bg-navy-950 text-white' : 'border-mist-200 bg-white text-navy-900 hover:bg-mist-50'}`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      <section className="space-y-3">

        {applications.length ? applications.map((application) => (
          <ApplicationCard key={application.applicationId} application={application} canDecide={canDecide} />
        )) : (
          <div className="rounded-xl border border-dashed border-mist-200 bg-white p-8 text-center">
            <p className="mt-3 font-bold text-navy-950">No trainer applications in this queue.</p>
            <p className="mt-1 text-sm text-muted">Choose another status to review trainer application history.</p>
          </div>
        )}
      </section>

      {access.kind === 'country' ? (
        <>
          <PendingCourseReviewsPanel reviews={pendingReviews} canDecide={canDecide} />
          <CourseReviewRepliesPanel replies={reviewReplies} canDecide={canDecide} />
        </>
      ) : null}
    </div>
  )
}
