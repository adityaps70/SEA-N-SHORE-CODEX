import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  GraduationCap,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { mentorAnalyticsRepository } from '@/features/learning/mentor-analytics-repository'
import { learningRepository } from '@/features/learning/repository'
import { organizationRepository } from '@/features/organizations/repository'

function statusLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default async function MentorLearningAnalyticsPage() {
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
  if (!hasActiveMentor && !hasOrganizationLmsAccess) return redirect('/learn/teach')

  const analytics = await mentorAnalyticsRepository.getForMentor(user.id)
  const { summary } = analytics
  const primaryMetrics = [
    { label: 'Enrollments', value: String(summary.enrollmentCount), icon: Users },
    { label: 'Completion rate', value: `${summary.completionRate}%`, icon: CheckCircle2 },
    { label: 'Average progress', value: `${summary.averageProgress}%`, icon: TrendingUp },
    { label: 'Certificates issued', value: String(summary.certificateCount), icon: Award },
  ]
  const operationalMetrics = [
    { label: 'In progress', value: summary.activeEnrollmentCount, icon: Clock3 },
    { label: 'Completed', value: summary.completedEnrollmentCount, icon: GraduationCap },
    { label: 'Assignments awaiting review', value: summary.pendingAssignmentCount, icon: BookOpenCheck },
    { label: 'Needs revision', value: summary.revisionAssignmentCount, icon: RefreshCw },
  ]

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/learn/studio" className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-navy-950">
        <ArrowLeft className="size-4" aria-hidden="true" /> Learning Studio
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200">Trainer & organization outcomes</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Learning analytics</h1>
            <p className="mt-3 text-sm leading-6 text-white/70">
              See aggregate learner progress across the courses you own. These outcomes stay privacy-safe and never expose learner-level profile data.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold text-white/80">
            <span className="rounded-full bg-white/10 px-3 py-1.5">{summary.courseCount} courses</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5">{summary.publishedCourseCount} published</span>
          </div>
        </div>
      </section>

      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Learning outcomes">
        {primaryMetrics.map(({ label, value, icon: Icon }) => (
          <article key={label} className="rounded-[1.4rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-muted">{label}</p>
              <span className="grid size-9 place-items-center rounded-xl bg-teal-50 text-teal-800">
                <Icon className="size-4" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-4 text-3xl font-bold tracking-tight text-navy-950">{value}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Operational outcomes">
        {operationalMetrics.map(({ label, value, icon: Icon }) => (
          <article key={label} className="rounded-2xl border border-mist-200 bg-mist-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
                <p className="mt-2 text-2xl font-bold text-navy-950">{value}</p>
              </div>
              <Icon className="mt-0.5 size-4 text-teal-800" aria-hidden="true" />
            </div>
          </article>
        ))}
      </section>

      {summary.pendingAssignmentCount > 0 ? (
        <div className="mt-4 flex justify-end">
          <Link
            href="/learn/studio/assignments"
            className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
          >
            Review assignments <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      ) : null}

      <section className="mt-9">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Course performance</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-950">Where learners are progressing</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-muted">Completion and progress use current, non-revoked enrollments. Assignment outcomes count submitted attempts so revision history stays visible.</p>
        </div>

        {analytics.courses.length ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {analytics.courses.map((course) => (
              <article key={course.courseId} className="rounded-[1.5rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700">{statusLabel(course.status)}</p>
                    <h3 className="mt-1 text-lg font-bold text-navy-950">{course.title}</h3>
                  </div>
                  <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-bold text-muted">{course.enrollmentCount} enrollments</span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-mist-50 p-3">
                    <p className="text-xs font-semibold text-muted">Completion</p>
                    <p className="mt-1 font-bold text-navy-950">{course.completionRate}%</p>
                  </div>
                  <div className="rounded-xl bg-mist-50 p-3">
                    <p className="text-xs font-semibold text-muted">Progress</p>
                    <p className="mt-1 font-bold text-navy-950">{course.averageProgress}%</p>
                  </div>
                  <div className="rounded-xl bg-mist-50 p-3">
                    <p className="text-xs font-semibold text-muted">Certificates</p>
                    <p className="mt-1 font-bold text-navy-950">{course.certificateCount} issued</p>
                  </div>
                  <div className="rounded-xl bg-mist-50 p-3">
                    <p className="text-xs font-semibold text-muted">To review</p>
                    <p className="mt-1 font-bold text-navy-950">{course.pendingAssignmentCount} attempts</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-muted">
                  <span>{course.activeEnrollmentCount} in progress</span>
                  <span>{course.completedEnrollmentCount} completed</span>
                  <span>{course.passedAssignmentCount} assignment passes</span>
                  <span>{course.revisionAssignmentCount} revision outcomes</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-7 text-center sm:p-10">
            <BookOpenCheck className="mx-auto size-7 text-teal-800" aria-hidden="true" />
            <h3 className="mt-3 text-lg font-bold text-navy-950">Publish your first course to start measuring learner outcomes</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Build a course in Learning Studio and this workspace will start summarizing enrollment, progress, completion and assessment outcomes automatically.</p>
            <Link
              href="/learn/studio/courses/new"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
            >
              Create course <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}