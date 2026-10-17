import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, BadgeCheck, BarChart3, BookOpen, CalendarDays, CheckCircle2, ClipboardCheck, Clock3, Eye, FilePenLine, Library, Plus, Receipt, Tag, Users, Wallet } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PlanHiddenBanner } from '@/features/billing/components/plan-hidden-banner'
import { PageActionsSheet } from '@/features/learning/components/page-actions-sheet'
import { StudioToolsMenu } from '@/features/learning/components/studio-tools-menu'
import { assignmentGradingRepository } from '@/features/learning/assignment-grading-repository'
import { courseRepository, type MentorCourseSummary } from '@/features/learning/course-repository'
import { learningRepository } from '@/features/learning/repository'
import { organizationRepository } from '@/features/organizations/repository'
import { batchRepository, type TeachingBatch } from '@/features/learning/batches/batch-repository'
import { batchStartLabel, batchStatusLabel } from '@/features/learning/batches/batch-rules'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'

export const metadata: Metadata = { title: 'Learning Studio' }

function statusLabel(status: MentorCourseSummary['status']) {
  if (status === 'draft') return 'Draft'
  if (status === 'submitted') return 'In review'
  if (status === 'changes_requested') return 'Changes requested'
  if (status === 'approved') return 'Approved'
  if (status === 'published') return 'Published'
  return 'Archived'
}

function statusClasses(status: MentorCourseSummary['status']) {
  if (status === 'published') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'approved') return 'border-teal-200 bg-teal-50 text-teal-800'
  if (status === 'changes_requested') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (status === 'submitted') return 'border-sky-200 bg-sky-50 text-sky-800'
  if (status === 'archived') return 'border-mist-200 bg-mist-50 text-muted'
  return 'border-mist-200 bg-white text-navy-950'
}

/** Round E (E9): "Recorded", "Live cohort", "Hybrid"; "All levels", "Advanced". */
function formatLabel(format: MentorCourseSummary['courseFormat']) {
  if (format === 'live_cohort') return 'Live cohort'
  if (format === 'hybrid') return 'Hybrid'
  return 'Recorded'
}

function levelLabel(level: MentorCourseSummary['level']) {
  const words = level.replace('_', ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** Round E (E9): Studio's status tabs. Approved courses wait to be published, so they sit with "In review". */
type StatusTab = 'live' | 'drafts' | 'review' | 'archived'
const STATUS_TABS: Array<{ id: StatusTab; label: string; statuses: ReadonlyArray<MentorCourseSummary['status']> }> = [
  { id: 'live', label: 'Live', statuses: ['published'] },
  { id: 'drafts', label: 'Drafts', statuses: ['draft', 'changes_requested'] },
  { id: 'review', label: 'In review', statuses: ['submitted', 'approved'] },
  { id: 'archived', label: 'Archived', statuses: ['archived'] },
]

function statusTabFrom(value: string | string[] | undefined): StatusTab | null {
  const raw = Array.isArray(value) ? value[0] : value
  return STATUS_TABS.some((tab) => tab.id === raw) ? raw as StatusTab : null
}

function revisionLabel(revision: NonNullable<MentorCourseSummary['openRevision']>) {
  if (revision.status === 'submitted') return 'Changes in review'
  if (revision.status === 'changes_requested') return 'Changes requested on your edits'
  return 'Draft changes in progress'
}

function CourseCard({ course }: { course: MentorCourseSummary }) {
  const editable = course.status === 'draft' || course.status === 'changes_requested'
  const livePublished = course.status === 'published'

  return (
    <article className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-meta text-muted">
            {course.category} <span aria-hidden="true">·</span> {levelLabel(course.level)}
          </p>
          <h3 className="mt-1 text-card-title font-semibold text-navy-950">{course.title}</h3>
          {course.subtitle ? <p className="mt-1 text-sm leading-6 text-muted">{course.subtitle}</p> : null}
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusClasses(course.status)}`}>
          {statusLabel(course.status)}
        </span>
      </div>

      {course.hiddenForPlan ? <PlanHiddenBanner companyId={course.companyId} className="mt-4" /> : null}

      {course.openRevision ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-xl border border-teal-100 bg-teal-50/70 px-3 py-2 text-sm font-semibold text-teal-900">
          <FilePenLine aria-hidden="true" className="size-4" /> {revisionLabel(course.openRevision)} · learners see the live version
        </p>
      ) : null}

      {course.adminReviewNote ? (
        <div className="mt-4 break-words rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-sm leading-6 text-amber-950">
          <span className="font-bold">Reviewer feedback:</span> {course.adminReviewNote}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-mist-100 pt-4">
        <div className="flex items-center gap-3 text-xs font-semibold text-muted">
          <span>{formatLabel(course.courseFormat)}</span>
          <span>{course.accessType === 'free' ? 'Free' : 'Paid'}</span>
        </div>
        {editable || livePublished ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/learn/studio/courses/${course.id}/batches`}
              aria-label={`Batches of ${course.title}`}
              className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm font-bold text-navy-950 transition hover:border-teal-300 hover:text-teal-800"
            >
              <CalendarDays aria-hidden="true" className="size-4" /> Batches
            </Link>
            {livePublished ? (
              <Link
                href={`/learn/studio/courses/${course.id}/learners`}
                aria-label={`Learners of ${course.title}`}
                className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm font-bold text-navy-950 transition hover:border-teal-300 hover:text-teal-800"
              >
                <Users aria-hidden="true" className="size-4" /> Learners
              </Link>
            ) : null}
          <Link
            href={`/learn/studio/courses/${course.openRevision?.courseId ?? course.id}/edit`}
            aria-label={`Edit ${course.title}`}
            className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm font-bold text-navy-950 transition hover:border-teal-300 hover:text-teal-800"
          >
            <FilePenLine aria-hidden="true" className="size-4" /> Edit course
          </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-muted">
              {course.status === 'submitted' ? <Clock3 aria-hidden="true" className="size-4" /> : <CheckCircle2 aria-hidden="true" className="size-4" />}
              {course.status === 'submitted' ? 'Sea N Shore review in progress' : statusLabel(course.status)}
            </span>
            <Link
              href={`/learn/studio/courses/${course.id}/edit`}
              aria-label={`View ${course.title}`}
              className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm font-bold text-navy-950 transition hover:border-teal-300 hover:text-teal-800"
            >
              <Eye aria-hidden="true" className="size-4" /> {course.status === 'submitted' ? 'View or withdraw' : 'View course'}
            </Link>
          </div>
        )}
      </div>
    </article>
  )
}

/** Round D (D1): batches this member runs as manager or instructor, on any course. */
function TeachingBatches({ teaching }: { teaching: readonly TeachingBatch[] }) {
  return (
    <section aria-labelledby="teaching-batches-heading" className="mt-6">
      <h2 id="teaching-batches-heading" className="text-section-title font-bold text-navy-950">Batches you teach</h2>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {teaching.map(({ batch, courseTitle, role }) => (
          <li key={batch.id}>
            <Link
              href={`/learn/studio/courses/${batch.courseId}/batches/${batch.id}`}
              className="block rounded-[1.2rem] border border-mist-200 bg-white p-4 shadow-[var(--shadow-card)] hover:border-teal-300"
            >
              <span className="block text-meta font-semibold text-muted">{courseTitle}</span>
              <span className="mt-1 block break-words font-bold text-navy-950">{batch.title}</span>
              <span className="mt-1 block text-sm text-muted">{batchStartLabel(batch)} · {batchStatusLabel(batch.status)} · {role === 'manager' ? 'Batch manager' : 'Instructor'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default async function MentorStudioPage({ searchParams }: { searchParams?: Promise<{ status?: string | string[] }> } = {}) {
  const [user, query] = await Promise.all([requireAwsUser(), searchParams ?? Promise.resolve<{ status?: string | string[] }>({})])
  const [mentorState, organizations] = await Promise.all([
    learningRepository.getMentorApplicationState(user.id),
    organizationRepository.listUserOrganizations(user.id),
  ])
  const hasActiveMentor = mentorState.kind === 'mentor' && mentorState.mentorStatus === 'active'
  const hasOrganizationLmsAccess = organizations.some((organization) =>
    organization.role === 'owner'
    || organization.role === 'administrator'
    || organization.role === 'lms_manager')

  const teaching = await batchRepository.listTeaching(user.id)

  if (!hasActiveMentor && !hasOrganizationLmsAccess) {
    if (!teaching.length) return redirect('/learn/teach')
    // A batch manager or instructor who does not publish courses sees only their batches.
    return (
      <div className="mx-auto w-full max-w-page-wide py-6 max-md:pt-0 sm:px-6 lg:px-8">
        <MobilePageBar backHref="/learn" title="Learning Studio" />
        <h1 className="text-2xl font-bold text-navy-950 max-md:hidden">Learning Studio</h1>
        <TeachingBatches teaching={teaching} />
      </div>
    )
  }

  const [courses, assignmentAttempts] = await Promise.all([
    courseRepository.listOwnedCourses(user.id),
    assignmentGradingRepository.listForMentor(user.id),
  ])
  const draftCount = courses.filter((course) => course.status === 'draft' || course.status === 'changes_requested').length
  const reviewCount = courses.filter((course) => course.status === 'submitted').length
  const liveCount = courses.filter((course) => course.status === 'published').length
  const pendingLearnerReviews = assignmentAttempts.filter((attempt) => attempt.status === 'submitted').length
  const tabCounts = Object.fromEntries(STATUS_TABS.map((tab) => [tab.id, courses.filter((course) => tab.statuses.includes(course.status)).length])) as Record<StatusTab, number>
  // Opens on Live when something is live, otherwise on the first tab with courses.
  const activeTab = statusTabFrom(query.status) ?? STATUS_TABS.find((tab) => tabCounts[tab.id] > 0)?.id ?? 'live'
  const shownCourses = courses.filter((course) => STATUS_TABS.find((tab) => tab.id === activeTab)!.statuses.includes(course.status))
  const tools = [
    { href: '/learn/studio/analytics', label: 'Analytics', icon: <BarChart3 aria-hidden="true" /> },
    { href: '/learn/studio/sales', label: 'Course sales', icon: <Receipt aria-hidden="true" /> },
    { href: '/learn/studio/promo-codes', label: 'Promo codes', icon: <Tag aria-hidden="true" /> },
    { href: '/settings/earnings', label: 'Earnings & payouts', icon: <Wallet aria-hidden="true" /> },
    { href: '/learn/studio/assignments', label: 'Review assignments', icon: <ClipboardCheck aria-hidden="true" /> },
    { href: '/learn/studio/question-bank', label: 'Question bank', icon: <Library aria-hidden="true" /> },
    { href: '/learn/teach', label: 'Trainer verification', icon: <BadgeCheck aria-hidden="true" /> },
  ]

  return (
    <div className="mx-auto w-full max-w-page-wide py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar
        backHref="/learn"
        title="Learning Studio"
        right={(
          <PageActionsSheet
            label="More studio actions"
            title="Learning Studio"
            actions={tools.map((tool) => ({ kind: 'link' as const, ...tool }))}
          />
        )}
      />
      {/* Round E (E9): one "Tools" menu and the primary "Create course" on the right. Phones use the page bar's "…" sheet. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="max-md:hidden">
          <StudioToolsMenu tools={tools} />
        </div>
        <Link
          href="/learn/studio/courses/new"
          className={cn(buttonClass(), 'max-md:w-full max-md:rounded-full max-md:text-[15px]')}
        >
          <Plus aria-hidden="true" className="size-4" /> Create course
        </Link>
      </div>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] max-md:mt-3 max-md:rounded-2xl max-md:p-3 sm:p-8">
        <div className="grid gap-7 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          {/* Phones: the page bar carries the title, so only the metrics show here. */}
          <div className="max-md:hidden">
            <h1 className="text-page-title font-bold">Learning Studio</h1>
            <p className="mt-1 text-meta font-semibold text-teal-200">{hasActiveMentor ? 'Verified trainer workspace' : 'Organization LMS workspace'}</p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/72 sm:text-base">
              Build practical maritime courses, respond to quality feedback and manage learner work from one workspace—personally or for an organization you are authorized to represent.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 max-md:[&>div]:p-2.5 max-md:[&_p:first-child]:text-xl lg:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-2xl font-bold">{draftCount}</p>
              <p className="mt-1 text-xs text-white/65">Building</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-2xl font-bold">{reviewCount}</p>
              <p className="mt-1 text-xs text-white/65">In review</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-2xl font-bold">{liveCount}</p>
              <p className="mt-1 text-xs text-white/65">Published</p>
            </div>
            <div className="rounded-2xl border border-teal-300/25 bg-teal-300/10 p-3">
              <p className="text-2xl font-bold">{pendingLearnerReviews}</p>
              <p className="mt-1 text-xs text-teal-100">Learner reviews</p>
            </div>
          </div>
        </div>
      </section>

      {pendingLearnerReviews > 0 ? (
        <section className="mt-5 rounded-[1.4rem] border border-teal-200 bg-teal-50 p-5 shadow-[var(--shadow-card)] sm:flex sm:items-center sm:justify-between sm:gap-5">
          <div>
            <h2 className="text-card-title font-semibold text-navy-950">
              {pendingLearnerReviews} learner submission{pendingLearnerReviews === 1 ? '' : 's'} need{pendingLearnerReviews === 1 ? 's' : ''} your review
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">Learner progression remains locked until an assignment receives a passing trainer grade.</p>
          </div>
          <Link
            href="/learn/studio/assignments"
            className="mt-4 inline-flex shrink-0 items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 sm:mt-0"
          >
            Review {pendingLearnerReviews} learner submission{pendingLearnerReviews === 1 ? '' : 's'} <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="text-section-title font-bold text-navy-950 max-md:text-[17px]">Courses</h2>

        {courses.length ? (
          <>
            <nav aria-label="Course status" className="mt-3 flex gap-1 overflow-x-auto rounded-xl bg-mist-100 p-1 sm:inline-flex">
              {STATUS_TABS.map((tab) => {
                const current = tab.id === activeTab
                return (
                  <Link
                    key={tab.id}
                    href={`/learn/studio?status=${tab.id}`}
                    scroll={false}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${current ? 'bg-white text-navy-950 shadow-sm' : 'text-navy-700 hover:bg-white/60'}`}
                  >
                    {tab.label}
                    <span className={`rounded-full px-2 text-xs font-bold ${current ? 'bg-mist-100 text-navy-900' : 'bg-white/70 text-navy-800'}`}>{tabCounts[tab.id]}</span>
                  </Link>
                )
              })}
            </nav>
            {shownCourses.length ? (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {shownCourses.map((course) => <CourseCard key={course.id} course={course} />)}
              </div>
            ) : (
              <p className="mt-4 rounded-2xl border border-dashed border-mist-200 bg-white p-6 text-center text-sm text-muted">
                {activeTab === 'live' ? 'No live courses yet.' : activeTab === 'drafts' ? 'No drafts.' : activeTab === 'review' ? 'Nothing in review.' : 'No archived courses.'}
              </p>
            )}
          </>
        ) : (
          <div className="mt-4 rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-7 text-center shadow-[var(--shadow-card)] sm:p-10">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-800">
              <BookOpen aria-hidden="true" className="size-5" />
            </span>
            <h2 className="mt-4 text-xl font-bold text-navy-950">Create your first maritime course</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">
              Start with one focused professional outcome. You can organize the curriculum into sections and lessons after the course foundation is saved.
            </p>
            <Link
              href="/learn/studio/courses/new"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
            >
              Start a course <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        )}
      </section>
      {teaching.length ? <TeachingBatches teaching={teaching} /> : null}
    </div>
  )
}