import Link from 'next/link'
import {
  Award,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  GraduationCap,
  RefreshCw,
  TrendingUp,
  UserRoundCheck,
  Users,
} from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { adminLearningAnalyticsRepository } from '@/features/learning/admin-analytics-repository'

function statusLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default async function AdminLearningAnalyticsPage() {
  const user = await requireAwsUser()
  const analytics = await adminLearningAnalyticsRepository.getPlatformAnalytics(user.id)
  const { summary } = analytics

  const primaryMetrics = [
    { label: 'Active mentors', value: String(summary.activeMentorCount), icon: UserRoundCheck },
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
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[1.6rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
              <BarChart3 aria-hidden="true" className="size-4" /> Platform outcomes
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">Learning analytics</h1>
            <p className="mt-2 text-sm leading-6 text-white/72">
              Track aggregate learning health across Sea N Shore without exposing learner-level identity or submission content. Progress metrics exclude revoked enrollments.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold text-white/80">
            <span className="rounded-full bg-white/10 px-3 py-1.5">{summary.courseCount} courses</span>
            <span className="rounded-full bg-white/10 px-3 py-1.5">{summary.publishedCourseCount} published</span>
          </div>
        </div>
      </section>

      <nav aria-label="Learning administration" className="flex flex-wrap gap-2">
        <Link
          href="/admin/learning"
          className="rounded-full border border-mist-100 bg-white px-4 py-2 text-sm font-bold text-muted transition hover:text-navy-950"
        >
          Trainer verifications
        </Link>
        <Link
          href="/admin/learning/courses"
          className="rounded-full border border-mist-100 bg-white px-4 py-2 text-sm font-bold text-muted transition hover:text-navy-950"
        >
          Course review
        </Link>
        <Link
          href="/admin/learning/analytics"
          aria-current="page"
          className="rounded-full bg-navy-950 px-4 py-2 text-sm font-bold text-white"
        >
          Analytics
        </Link>
      </nav>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Platform learning outcomes">
        {primaryMetrics.map(({ label, value, icon: Icon }) => (
          <article key={label} className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-muted">{label}</p>
              <span className="grid size-9 place-items-center rounded-xl bg-teal-50 text-teal-800">
                <Icon aria-hidden="true" className="size-4" />
              </span>
            </div>
            <p className="mt-4 text-3xl font-bold tracking-tight text-navy-950">{value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Operational learning outcomes">
        {operationalMetrics.map(({ label, value, icon: Icon }) => (
          <article key={label} className="rounded-2xl border border-mist-100 bg-mist-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
                <p className="mt-2 text-2xl font-bold text-navy-950">{value}</p>
              </div>
              <Icon aria-hidden="true" className="mt-0.5 size-4 text-teal-800" />
            </div>
          </article>
        ))}
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Course performance</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-950">Learning health by course</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-muted">
            Aggregates preserve operational visibility while keeping learner identities, responses and uploaded evidence out of this dashboard.
          </p>
        </div>

        {analytics.courses.length ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {analytics.courses.map((course) => (
              <article key={course.courseId} className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700">{statusLabel(course.status)}</p>
                    <h3 className="mt-1 text-lg font-bold text-navy-950">{course.title}</h3>
                  </div>
                  <span className="shrink-0 rounded-full bg-mist-50 px-3 py-1 text-xs font-bold text-muted">
                    {course.enrollmentCount} enrollments
                  </span>
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
          <div className="mt-5 rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center sm:p-10">
            <BookOpenCheck aria-hidden="true" className="mx-auto size-7 text-teal-700" />
            <h3 className="mt-3 text-lg font-bold text-navy-950">No learning activity to report yet.</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
              Approve qualified maritime mentors and courses first. Platform outcomes will appear here as learners enroll and complete training.
            </p>
            <Link
              href="/admin/learning"
              className="mt-5 inline-flex items-center rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
            >
              Review trainer applications
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}
