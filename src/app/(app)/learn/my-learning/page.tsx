import Link from 'next/link'
import { ArrowRight, Award, BadgeCheck, BookOpen, CheckCircle2, GraduationCap } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  enrollmentRepository,
  type LearnerCourseEnrollment,
} from '@/features/learning/enrollment-repository'

function levelLabel(level: LearnerCourseEnrollment['level']) {
  if (level === 'all_levels') return 'All levels'
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

function formatLabel(format: LearnerCourseEnrollment['courseFormat']) {
  if (format === 'live_cohort') return 'Live cohort'
  if (format === 'hybrid') return 'Hybrid'
  return 'Recorded'
}

function EnrollmentCard({ enrollment }: { enrollment: LearnerCourseEnrollment }) {
  const completed = enrollment.enrollmentStatus === 'completed'

  return (
    <article
      aria-label={enrollment.title}
      className="overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]"
    >
      <div className="bg-gradient-to-br from-navy-950 via-navy-900 to-teal-800 p-5 text-white sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white/85">
            <BookOpen aria-hidden="true" className="size-3.5" /> {enrollment.category}
          </span>
          {completed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.1em] text-navy-950">
              <CheckCircle2 aria-hidden="true" className="size-3.5" /> Completed
            </span>
          ) : null}
        </div>
        <h2 className="mt-5 text-2xl font-bold tracking-tight">{enrollment.title}</h2>
        {enrollment.subtitle ? <p className="mt-2 text-sm leading-6 text-white/72">{enrollment.subtitle}</p> : null}
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-muted">
          <span className="rounded-full bg-mist-50 px-2.5 py-1">{levelLabel(enrollment.level)}</span>
          <span className="rounded-full bg-mist-50 px-2.5 py-1">{formatLabel(enrollment.courseFormat)}</span>
          {enrollment.certificateEnabled ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-teal-800">
              <Award aria-hidden="true" className="size-3.5" /> Certificate
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-2 border-t border-mist-100 pt-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-950 text-xs font-extrabold text-white">
            {enrollment.mentorName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-navy-950">{enrollment.mentorName}</p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-teal-800">
              <BadgeCheck aria-hidden="true" className="size-3.5" /> Verified mentor
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-mist-100 bg-mist-50/70 p-4">
          <div className="flex items-center justify-between gap-3 text-sm font-bold text-navy-950">
            <span>{enrollment.completedLessons} of {enrollment.totalLessons} lessons completed</span>
            <span>{enrollment.progressPercent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={`${enrollment.title} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={enrollment.progressPercent}
            className="mt-3 h-2 overflow-hidden rounded-full bg-mist-200"
          >
            <div className="h-full rounded-full bg-teal-700" style={{ width: `${enrollment.progressPercent}%` }} />
          </div>
        </div>

        <Link
          href={`/learn/courses/${enrollment.slug}/learn`}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
        >
          {completed ? 'Review course' : 'Continue learning'} <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </article>
  )
}

export default async function MyLearningPage() {
  const user = await requireAwsUser()
  const enrollments = await enrollmentRepository.listLearnerEnrollments(user.id)

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[1.9rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8 lg:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.17em] text-teal-200">Sea N Shore Learning</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">My Learning</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
          Your enrolled maritime courses and real learning progress, in one place.
        </p>
      </section>

      {enrollments.length ? (
        <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {enrollments.map((enrollment) => (
            <EnrollmentCard key={enrollment.enrollmentId} enrollment={enrollment} />
          ))}
        </section>
      ) : (
        <section className="mt-6 rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center shadow-[var(--shadow-card)] sm:p-10">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-800">
            <GraduationCap aria-hidden="true" className="size-5" />
          </span>
          <h2 className="mt-4 text-xl font-bold text-navy-950">No courses yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">
            Courses you enroll in will appear here with their real progress and completion status.
          </p>
          <Link
            href="/learn"
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
          >
            Explore courses <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </section>
      )}
    </main>
  )
}
