import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Archive,
  BadgeCheck,
  BookOpenCheck,
  CircleDollarSign,
  GraduationCap,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  learningAdminRepository,
  type CourseReviewItem,
} from '@/features/learning/admin-repository'
import { CourseReviewControls } from '@/features/learning/components/course-review-controls'
import type { CourseStatus } from '@/features/learning/course-workflow'

export const metadata: Metadata = { title: 'Course review · Admin' }

const statusFilters: Array<{ value: CourseStatus; label: string }> = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'changes_requested', label: 'Changes requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
]

function selectedStatus(value: string | string[] | undefined): CourseStatus {
  const normalized = Array.isArray(value) ? value[0] : value
  if (
    normalized === 'submitted'
    || normalized === 'changes_requested'
    || normalized === 'approved'
    || normalized === 'published'
    || normalized === 'archived'
  ) return normalized
  return 'submitted'
}

function statusLabel(status: CourseStatus) {
  return statusFilters.find((filter) => filter.value === status)?.label ?? status
}

function levelLabel(level: CourseReviewItem['level']) {
  if (level === 'all_levels') return 'All levels'
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

function formatLabel(format: CourseReviewItem['courseFormat']) {
  if (format === 'live_cohort') return 'Live cohort'
  if (format === 'hybrid') return 'Hybrid'
  return 'Recorded'
}

function lessonTypeLabel(value: string) {
  return value.split('_').map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ')
}

function pricingLabel(course: CourseReviewItem) {
  if (course.accessType === 'free' || course.priceMinor === 0) return 'Free access'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: course.currency,
    maximumFractionDigits: 0,
  }).format(course.priceMinor / 100)
}

function isActionable(status: CourseStatus) {
  return status === 'submitted' || status === 'approved' || status === 'published'
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-mist-100 bg-mist-50 px-2.5 py-1 text-xs font-semibold text-navy-900">
      {children}
    </span>
  )
}

function EvidenceList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.length
          ? items.map((item) => <Chip key={item}>{item}</Chip>)
          : <span className="text-sm text-muted">{empty}</span>}
      </div>
    </section>
  )
}

function CurriculumEvidence({ course }: { course: CourseReviewItem }) {
  if (!course.curriculum.length) {
    return (
      <section className="mt-5 rounded-2xl border border-dashed border-mist-200 bg-mist-50/40 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Curriculum & assessment</p>
        <p className="mt-2 text-sm text-muted">No curriculum evidence is available for this course.</p>
      </section>
    )
  }

  const lessonCount = course.curriculum.reduce((total, section) => total + section.lessons.length, 0)
  const moduleLabel = `${course.curriculum.length} ${course.curriculum.length === 1 ? 'module' : 'modules'}`
  const lessonLabel = `${lessonCount} ${lessonCount === 1 ? 'lesson' : 'lessons'}`

  return (
    <details open className="mt-5 rounded-2xl border border-mist-100 bg-mist-50/50 p-4">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Curriculum & assessment</p>
          <span className="text-xs font-bold text-muted">{moduleLabel} · {lessonLabel}</span>
        </div>
      </summary>

      <div className="mt-4 space-y-4">
        {course.curriculum.map((section) => (
          <section key={section.id} className="rounded-2xl border border-mist-100 bg-white p-4">
            <h3 className="font-bold text-navy-950">{section.title}</h3>
            <div className="mt-3 space-y-3">
              {section.lessons.map((lesson) => (
                <article key={lesson.id} className="rounded-xl border border-mist-100 bg-mist-50/40 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-navy-950">{lesson.title}</p>
                    <Chip>{lessonTypeLabel(lesson.lessonType)}</Chip>
                    {lesson.durationSeconds !== null ? <Chip>{Math.ceil(lesson.durationSeconds / 60)} min</Chip> : null}
                    {lesson.isPreview ? <Chip>Preview</Chip> : null}
                    {lesson.isDownloadable ? <Chip>Downloadable</Chip> : null}
                  </div>
                  {lesson.summary ? <p className="mt-2 text-sm leading-6 text-muted">{lesson.summary}</p> : null}
                  {lesson.articleBody ? (
                    <div className="mt-3 rounded-xl border border-mist-100 bg-white p-3 text-sm leading-6 text-navy-900 whitespace-pre-wrap">
                      {lesson.articleBody}
                    </div>
                  ) : null}
                  {lesson.assetPath ? <p className="mt-2 break-all text-xs font-semibold text-muted">Asset: {lesson.assetPath}</p> : null}
                  {lesson.externalUrl ? <p className="mt-2 break-all text-xs font-semibold text-muted">URL: {lesson.externalUrl}</p> : null}

                  {lesson.quiz ? (
                    <section className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-sky-800">Assessment</span>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-sky-900">Pass mark {lesson.quiz.passPercentage}%</span>
                      </div>
                      {lesson.quiz.instructions ? <p className="mt-2 text-sm text-sky-950">{lesson.quiz.instructions}</p> : null}
                      <div className="mt-3 space-y-3">
                        {lesson.quiz.questions.map((question, questionIndex) => (
                          <div key={question.id} className="rounded-xl border border-sky-100 bg-white p-3">
                            <p className="text-sm font-bold text-navy-950">Question {questionIndex + 1}</p>
                            <p className="mt-1 text-sm text-navy-900">{question.prompt}</p>
                            <ul className="mt-2 space-y-1.5">
                              {question.options.map((option) => (
                                <li key={option.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-mist-50 px-3 py-2 text-sm text-navy-900">
                                  <span>{option.label}</span>
                                  {option.isCorrect ? (
                                    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-teal-900">Correct answer</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  )
}

function CourseCard({ course }: { course: CourseReviewItem }) {
  return (
    <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800">
              {statusLabel(course.status)}
            </span>
            <span className="text-xs font-semibold text-muted">
              Updated {new Date(course.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>

          <h2 className="mt-3 text-xl font-bold text-navy-950">{course.title}</h2>
          {course.subtitle ? <p className="mt-1 text-sm font-semibold text-muted">{course.subtitle}</p> : null}
          <p className="mt-3 text-sm leading-6 text-navy-900">{course.description}</p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Chip>{course.category}</Chip>
            <Chip>{levelLabel(course.level)}</Chip>
            <Chip>{formatLabel(course.courseFormat)}</Chip>
            <Chip>{course.language}</Chip>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-100 bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800">
              <CircleDollarSign aria-hidden="true" className="size-3.5" /> {pricingLabel(course)}
            </span>
            {course.certificateEnabled ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-800">
                <BadgeCheck aria-hidden="true" className="size-3.5" /> Certificate enabled
              </span>
            ) : null}
          </div>

          <section className="mt-5 rounded-2xl border border-mist-100 bg-mist-50/70 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Verified trainer</p>
            <p className="mt-2 text-sm font-bold text-navy-950">{course.mentorName}</p>
            <p className="mt-1 text-xs font-semibold text-muted">Trainer record ID {course.mentorId}</p>
          </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <EvidenceList
              title="Learning outcomes"
              items={course.learningOutcomes}
              empty="No learning outcomes listed."
            />
            <EvidenceList
              title="Requirements"
              items={course.requirements}
              empty="No requirements listed."
            />
            <EvidenceList
              title="Target audience"
              items={course.targetAudience}
              empty="No target audience listed."
            />
          </div>

          <CurriculumEvidence course={course} />

          {course.adminReviewNote ? (
            <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800">Administrator review note</p>
              <p className="mt-2 text-sm leading-6 text-amber-950">{course.adminReviewNote}</p>
            </div>
          ) : null}
        </div>

        {isActionable(course.status) ? (
          <div className="w-full shrink-0 xl:w-[22rem]">
            <CourseReviewControls courseId={course.courseId} status={course.status} />
          </div>
        ) : null}
      </div>
    </article>
  )
}

export default async function LearningCoursesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>
}) {
  const user = await requireAwsUser()
  const params = await searchParams
  const status = selectedStatus(params.status)
  const courses = await learningAdminRepository.listCoursesForReview(user.id, status)

  return (
    <main className="space-y-6">
      <section className="overflow-hidden rounded-[1.6rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-7">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
              <GraduationCap aria-hidden="true" className="size-4" /> Sea N Shore Learning
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">Course review</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/72">
              Protect marketplace quality with a human review gate. Validate maritime relevance, learner outcomes and course positioning before approval and publication.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <ShieldCheck aria-hidden="true" className="size-4 text-teal-200" />
              <p className="mt-2 text-xs font-bold text-white">Quality gate</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <UserRoundCheck aria-hidden="true" className="size-4 text-teal-200" />
              <p className="mt-2 text-xs font-bold text-white">Verified trainers</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <BookOpenCheck aria-hidden="true" className="size-4 text-teal-200" />
              <p className="mt-2 text-xs font-bold text-white">Publish control</p>
            </div>
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
          aria-current="page"
          className="rounded-full bg-navy-950 px-4 py-2 text-sm font-bold text-white"
        >
          Course review
        </Link>
        <Link
          href="/admin/learning/analytics"
          className="rounded-full border border-mist-100 bg-white px-4 py-2 text-sm font-bold text-muted transition hover:text-navy-950"
        >
          Analytics
        </Link>
      </nav>

      <nav aria-label="Course review status" className="flex flex-wrap gap-2">
        {statusFilters.map((filter) => (
          <Link
            key={filter.value}
            href={`/admin/learning/courses?status=${filter.value}`}
            aria-current={status === filter.value ? 'page' : undefined}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${status === filter.value ? 'bg-teal-700 text-white' : 'border border-mist-100 bg-white text-muted hover:text-navy-950'}`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Course quality queue</p>
            <h2 className="mt-1 text-xl font-bold text-navy-950">{statusLabel(status)}</h2>
          </div>
          <p className="text-sm font-semibold text-muted">{courses.length} {courses.length === 1 ? 'course' : 'courses'}</p>
        </div>

        {courses.length ? courses.map((course) => (
          <CourseCard key={course.courseId} course={course} />
        )) : (
          <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center">
            <Archive aria-hidden="true" className="mx-auto size-7 text-teal-700" />
            <p className="mt-3 font-bold text-navy-950">No courses in this review queue.</p>
            <p className="mt-1 text-sm text-muted">Choose another status to review course history and publication state.</p>
          </div>
        )}
      </section>
    </main>
  )
}
