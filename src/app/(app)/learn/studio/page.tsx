import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, ArrowRight, BarChart3, BookOpen, CheckCircle2, Clock3, FilePenLine, Plus, Sparkles } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { assignmentGradingRepository } from '@/features/learning/assignment-grading-repository'
import { courseRepository, type MentorCourseSummary } from '@/features/learning/course-repository'
import { learningRepository } from '@/features/learning/repository'
import { organizationRepository } from '@/features/organizations/repository'

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

function CourseCard({ course }: { course: MentorCourseSummary }) {
  const editable = course.status === 'draft' || course.status === 'changes_requested'

  return (
    <article className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">
            <span>{course.category}</span>
            <span aria-hidden="true">•</span>
            <span>{course.level.replace('_', ' ')}</span>
          </div>
          <h2 className="mt-2 text-lg font-bold text-navy-950">{course.title}</h2>
          {course.subtitle ? <p className="mt-1 text-sm leading-6 text-muted">{course.subtitle}</p> : null}
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusClasses(course.status)}`}>
          {statusLabel(course.status)}
        </span>
      </div>

      {course.adminReviewNote ? (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-sm leading-6 text-amber-950">
          <span className="font-bold">Reviewer feedback:</span> {course.adminReviewNote}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-mist-100 pt-4">
        <div className="flex items-center gap-3 text-xs font-semibold text-muted">
          <span>{course.courseFormat.replace('_', ' ')}</span>
          <span>{course.accessType === 'free' ? 'Free' : 'Paid metadata'}</span>
        </div>
        {editable ? (
          <Link
            href={`/learn/studio/courses/${course.id}/edit`}
            aria-label={`Edit ${course.title}`}
            className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm font-bold text-navy-950 transition hover:border-teal-300 hover:text-teal-800"
          >
            <FilePenLine aria-hidden="true" className="size-4" /> Edit course
          </Link>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-muted">
            {course.status === 'submitted' ? <Clock3 aria-hidden="true" className="size-4" /> : <CheckCircle2 aria-hidden="true" className="size-4" />}
            {course.status === 'submitted' ? 'Sea N Shore review in progress' : statusLabel(course.status)}
          </span>
        )}
      </div>
    </article>
  )
}

export default async function MentorStudioPage() {
  const user = await requireAwsUser()
  const [mentorState, organizations] = await Promise.all([
    learningRepository.getMentorApplicationState(user.id),
    organizationRepository.listUserOrganizations(user.id),
  ])
  const hasActiveMentor = mentorState.kind === 'mentor' && mentorState.mentorStatus === 'active'
  const hasOrganizationLmsAccess = organizations.some((organization) =>
    organization.role === 'owner'
    || organization.role === 'administrator'
    || organization.role === 'lms_manager')

  if (!hasActiveMentor && !hasOrganizationLmsAccess) {
    return redirect('/learn/teach')
  }

  const [courses, assignmentAttempts] = await Promise.all([
    courseRepository.listOwnedCourses(user.id),
    assignmentGradingRepository.listForMentor(user.id),
  ])
  const draftCount = courses.filter((course) => course.status === 'draft' || course.status === 'changes_requested').length
  const reviewCount = courses.filter((course) => course.status === 'submitted').length
  const liveCount = courses.filter((course) => course.status === 'published').length
  const pendingLearnerReviews = assignmentAttempts.filter((attempt) => attempt.status === 'submitted').length

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/learn/teach" className="inline-flex items-center gap-2 text-sm font-bold text-muted transition hover:text-navy-950">
          <ArrowLeft aria-hidden="true" className="size-4" /> Mentor profile
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/learn/studio/analytics"
            className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 transition hover:border-teal-300 hover:text-teal-800"
          >
            <BarChart3 aria-hidden="true" className="size-4" /> Analytics
          </Link>
          <Link
            href="/learn/studio/assignments"
            className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 transition hover:border-teal-300 hover:text-teal-800"
          >
            Review assignments <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            href="/learn/studio/courses/new"
            className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
          >
            <Plus aria-hidden="true" className="size-4" /> Create course
          </Link>
        </div>
      </div>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <div className="grid gap-7 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
              <Sparkles aria-hidden="true" className="size-4" /> {hasActiveMentor ? 'Verified trainer workspace' : 'Organization LMS workspace'}
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Learning Studio</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/72 sm:text-base">
              Build practical maritime courses, respond to quality feedback and manage learner work from one workspace—personally or for an organization you are authorized to represent.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
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
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-800">Assignments awaiting review</p>
            <h2 className="mt-1 text-lg font-bold text-navy-950">
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Your learning portfolio</p>
            <h2 className="mt-1 text-2xl font-bold text-navy-950">Courses</h2>
          </div>
          {courses.length ? (
            <Link href="/learn/studio/courses" className="inline-flex items-center gap-2 text-sm font-bold text-teal-800 hover:text-teal-700">
              Manage all courses <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </div>

        {courses.length ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {courses.map((course) => <CourseCard key={course.id} course={course} />)}
          </div>
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
    </main>
  )
}