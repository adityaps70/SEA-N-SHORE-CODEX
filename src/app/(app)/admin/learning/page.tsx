import Link from 'next/link'
import { BookOpenCheck, ExternalLink, GraduationCap, ShieldCheck, UserRoundCheck } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  learningAdminRepository,
  type MentorApplicationReviewItem,
} from '@/features/learning/admin-repository'
import type { MentorApplicationStatus } from '@/features/learning/mentor-application'
import { MentorReviewControls } from '@/features/learning/components/mentor-review-controls'

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

function ApplicationCard({ application }: { application: MentorApplicationReviewItem }) {
  return (
    <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
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
            <span>{application.yearsExperience} years</span>
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
            <MentorReviewControls applicationId={application.applicationId} />
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
  const user = await requireAwsUser()
  const params = await searchParams
  const status = selectedStatus(params.status)
  const applications = await learningAdminRepository.listMentorApplications(user.id, status)

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[1.6rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-7">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
              <GraduationCap aria-hidden="true" className="size-4" /> Sea N Shore Learning
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">Learning review</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/72">
              Review maritime professionals before they can teach. Approval activates mentor access; every course will still require a separate Sea N Shore quality review before publication.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <ShieldCheck aria-hidden="true" className="size-4 text-teal-200" />
              <p className="mt-2 text-xs font-bold text-white">Verified access</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <UserRoundCheck aria-hidden="true" className="size-4 text-teal-200" />
              <p className="mt-2 text-xs font-bold text-white">Human review</p>
            </div>
            <div className="hidden rounded-2xl border border-white/10 bg-white/5 px-4 py-3 sm:block">
              <BookOpenCheck aria-hidden="true" className="size-4 text-teal-200" />
              <p className="mt-2 text-xs font-bold text-white">Course gate</p>
            </div>
          </div>
        </div>
      </section>

      <nav aria-label="Learning administration" className="flex flex-wrap gap-2">
        <Link
          href="/admin/learning"
          aria-current="page"
          className="rounded-full bg-navy-950 px-4 py-2 text-sm font-bold text-white"
        >
          Mentor approvals
        </Link>
        <Link
          href="/admin/learning/courses"
          className="rounded-full border border-mist-100 bg-white px-4 py-2 text-sm font-bold text-muted transition hover:text-navy-950"
        >
          Course review
        </Link>
      </nav>

      <nav aria-label="Mentor application status" className="flex flex-wrap gap-2">
        {statusFilters.map((filter) => (
          <Link
            key={filter.value}
            href={`/admin/learning?status=${filter.value}`}
            aria-current={status === filter.value ? 'page' : undefined}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${status === filter.value ? 'bg-navy-950 text-white' : 'border border-mist-100 bg-white text-muted hover:text-navy-950'}`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Mentor applications</p>
            <h2 className="mt-1 text-xl font-bold text-navy-950">{statusLabel(status)}</h2>
          </div>
          <p className="text-sm font-semibold text-muted">{applications.length} {applications.length === 1 ? 'application' : 'applications'}</p>
        </div>

        {applications.length ? applications.map((application) => (
          <ApplicationCard key={application.applicationId} application={application} />
        )) : (
          <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center">
            <UserRoundCheck aria-hidden="true" className="mx-auto size-7 text-teal-700" />
            <p className="mt-3 font-bold text-navy-950">No mentor applications in this queue.</p>
            <p className="mt-1 text-sm text-muted">Choose another status to review mentor application history.</p>
          </div>
        )}
      </section>
    </main>
  )
}
