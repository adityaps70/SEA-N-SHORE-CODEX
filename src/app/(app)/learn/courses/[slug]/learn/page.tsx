import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Circle, GraduationCap, LockKeyhole } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { coursePaymentRepository } from '@/features/learning/course-payment-repository'
import { CourseCurriculumSheet } from '@/features/learning/components/course-curriculum-sheet'
import { MaterialPlayer } from '@/features/learning/components/material-player'
import { PageActionsSheet } from '@/features/learning/components/page-actions-sheet'
import {
  learnerCourseRepository,
  type LearnerCourse,
  type LearnerLesson,
} from '@/features/learning/learner-course-repository'
import { learnerQuizRepository } from '@/features/learning/learner-quiz-repository'
import { createMediaReadUrl } from '@/lib/aws/storage'

type LearnerCoursePageProps = {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ lesson?: string }>
}

function allLessons(course: LearnerCourse) {
  return course.sections.flatMap((section) => section.lessons)
}

function defaultLesson(course: LearnerCourse) {
  const lessons = allLessons(course)
  return lessons.find((lesson) => lesson.isAvailable && !lesson.completed)
    ?? lessons.find((lesson) => lesson.isAvailable)
    ?? lessons[0]
    ?? null
}

function lessonHref(slug: string, lessonId: string) {
  return `/learn/courses/${slug}/learn?lesson=${lessonId}`
}

function activityLabel(lesson: LearnerLesson) {
  return lesson.lessonType.replaceAll('_', ' ')
}

function shouldSignLessonAsset(lesson: LearnerLesson) {
  return lesson.isAvailable
    && Boolean(lesson.assetPath)
    && !['article', 'quiz', 'assignment', 'external_embed', 'scorm', 'live_session'].includes(lesson.lessonType)
}

/** Phones: course progress sits under the lesson title instead of in the header card. */
function PhoneCourseProgress({ percent, completed, total }: { percent: number; completed: number; total: number }) {
  return (
    <div className="mt-3 md:hidden">
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-mist-100">
        <div className="h-full rounded-full bg-teal-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1.5 text-sm text-muted">{percent}% complete · {completed} of {total}</p>
    </div>
  )
}

export default async function LearnerCoursePage({ params, searchParams }: LearnerCoursePageProps) {
  const [{ slug }, query, user] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ lesson?: string }>({}),
    requireAwsUser(),
  ])

  const course = await learnerCourseRepository.getLearnerCourse(user.id, slug)
  if (!course) return notFound()
  // Course team access (no purchase) lasts only while the person is still on the team.
  if (course.enrollmentSource === 'admin') {
    const stillOnTeam = await coursePaymentRepository.isCourseManager(user.id, course.courseId)
      || await canAccessPlatformAdmin(user.id)
    if (!stillOnTeam) return redirect(`/learn/courses/${course.slug}`)
  }

  const lessons = allLessons(course)
  const requestedLessonId = query.lesson
  const selectedLesson = requestedLessonId
    ? lessons.find((lesson) => lesson.id === requestedLessonId) ?? null
    : defaultLesson(course)

  if (requestedLessonId && !selectedLesson) return notFound()

  const selectedLessonIndex = selectedLesson
    ? lessons.findIndex((lesson) => lesson.id === selectedLesson.id)
    : -1
  const previousLesson = selectedLessonIndex > 0 ? lessons[selectedLessonIndex - 1] : null
  const nextLesson = selectedLessonIndex >= 0 && selectedLessonIndex < lessons.length - 1
    ? lessons[selectedLessonIndex + 1]
    : null

  const selectedQuiz = selectedLesson?.isAvailable && selectedLesson.lessonType === 'quiz'
    ? await learnerQuizRepository.getQuizForLearner(user.id, course.slug, selectedLesson.id)
    : null
  const selectedMediaUrl = selectedLesson?.assetPath && shouldSignLessonAsset(selectedLesson)
    ? await createMediaReadUrl(selectedLesson.assetPath)
    : null

  const curriculumList = (
    <div className="space-y-4">
      {course.sections.map((section) => (
        <section key={section.id} aria-label={section.title}>
          <h3 className="px-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{section.title}</h3>
          <div className="mt-2 space-y-1">
            {section.lessons.map((lesson) => {
              const active = selectedLesson?.id === lesson.id
              return (
                <Link
                  key={lesson.id}
                  href={lessonHref(course.slug, lesson.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-start gap-3 rounded-xl px-3 py-3 text-sm transition ${active ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  {lesson.completed ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : lesson.isAvailable ? (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    <span className="block font-medium">{lesson.title}</span>
                    <span className={`mt-1 block text-xs capitalize ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                      {activityLabel(lesson)}{lesson.completed ? ' · Completed' : !lesson.isAvailable ? ' · Locked' : ''}
                    </span>
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
  const lessonPosition = selectedLessonIndex + 1
  const curriculumSheet = (
    <CourseCurriculumSheet position={lessonPosition} total={lessons.length}>
      {curriculumList}
    </CourseCurriculumSheet>
  )

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 max-md:flex max-md:flex-col max-md:px-0 max-md:py-0 sm:px-6 lg:px-8">
      <MobilePageBar
        backHref={`/learn/courses/${course.slug}`}
        title={course.title}
        right={(
          <PageActionsSheet
            label="More course actions"
            actions={[
              { kind: 'link', href: `/learn/courses/${course.slug}`, label: 'Course overview', icon: <BookOpen aria-hidden="true" /> },
              { kind: 'link', href: '/learn/my-learning', label: 'My learning', icon: <GraduationCap aria-hidden="true" /> },
            ]}
          />
        )}
      />
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm max-md:hidden sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">My Learning · {course.category}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{course.title}</h1>
            {course.subtitle ? <p className="mt-3 text-base leading-7 text-slate-600">{course.subtitle}</p> : null}
            <p className="mt-3 text-sm text-slate-500">Mentored by {course.mentorName}</p>
          </div>

          <div className="min-w-56 rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium text-slate-700">{course.completedLessons} of {course.totalLessons} materials completed</span>
              <span className="font-semibold text-slate-950">{course.progressPercent}%</span>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-label={`${course.title} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={course.progressPercent}
            >
              <div className="h-full rounded-full bg-slate-950" style={{ width: `${course.progressPercent}%` }} />
            </div>
          </div>
        </div>
      </header>

      {course.enrollmentStatus === 'completed' ? (
        <section aria-label="Course completed" className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm max-md:order-last max-md:mt-4 max-md:p-5 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Learning milestone reached
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Course completed</h2>
              <p className="mt-2 text-sm leading-6 text-slate-700">All {course.totalLessons} published materials are complete. You can continue reviewing the curriculum below.</p>
              {course.certificateEnabled ? <p className="mt-2 text-sm text-slate-600">Your eligible Sea N Shore certificate is issued from the completed enrollment.</p> : null}
            </div>
            <Link href="/learn/my-learning" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
              Back to My Learning
            </Link>
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 max-md:mt-0 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Phones open the curriculum from the "Curriculum n/N" button beside the lesson actions. */}
        <nav aria-label="Course curriculum" className="h-fit rounded-3xl border border-slate-200 bg-white p-4 shadow-sm max-md:hidden lg:sticky lg:top-6">
          <div className="px-2 pb-3">
            <h2 className="text-sm font-semibold text-slate-950">Course curriculum</h2>
            <p className="mt-1 text-xs text-slate-500">
              {course.navigationMode === 'sequential' ? 'Sequential learning is enabled.' : 'Open navigation is enabled.'}
            </p>
          </div>

          {curriculumList}
        </nav>

        <main>
          {selectedLesson ? (
            <section aria-label="Current lesson" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:shadow-none sm:p-8">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 max-md:text-amber-800">
                <span className="md:hidden">Lesson {lessonPosition} of {lessons.length} ·</span>
                <span>{activityLabel(selectedLesson)}</span>
                {selectedLesson.durationSeconds ? <span>· {Math.ceil(selectedLesson.durationSeconds / 60)} min</span> : null}
                {selectedLesson.completed ? <span>· Completed</span> : !selectedLesson.isAvailable ? <span>· Locked</span> : null}
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 max-md:mt-2 max-md:text-xl max-md:font-bold max-md:text-navy-950 sm:text-3xl">{selectedLesson.title}</h2>
              <PhoneCourseProgress percent={course.progressPercent} completed={course.completedLessons} total={course.totalLessons} />
              {selectedLesson.summary ? <p className="mt-3 text-sm leading-6 text-slate-600">{selectedLesson.summary}</p> : null}

              <div className="mt-7 max-md:mt-5">
                <MaterialPlayer
                  lesson={selectedLesson}
                  mediaUrl={selectedMediaUrl}
                  slug={course.slug}
                  quiz={selectedQuiz}
                  nextLessonHref={nextLesson ? lessonHref(course.slug, nextLesson.id) : null}
                  phoneActions={curriculumSheet}
                />
              </div>

              {previousLesson || nextLesson ? (
                // Phones: one full-width "Next material" pill; the previous lesson is in the Curriculum sheet.
                <nav aria-label="Lesson navigation" className={`mt-7 flex items-center justify-between gap-3 border-t border-slate-200 pt-6 max-md:mt-5 max-md:border-t-0 max-md:pt-0 ${nextLesson ? '' : 'max-md:hidden'}`}>
                  <div className="max-md:hidden">
                    {previousLesson ? (
                      <Link href={lessonHref(course.slug, previousLesson.id)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Previous material
                      </Link>
                    ) : null}
                  </div>
                  <div className="max-md:w-full">
                    {nextLesson ? (
                      <Link href={lessonHref(course.slug, nextLesson.id)} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 max-md:min-h-11 max-md:w-full max-md:justify-center max-md:rounded-full max-md:bg-ocean-700 max-md:py-0 max-md:text-[15px] max-md:hover:bg-ocean-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500">
                        Next material <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </nav>
              ) : null}
            </section>
          ) : (
            <section aria-label="Current lesson" className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-950">No materials published yet</h2>
              <p className="mt-2 text-sm text-slate-500">This enrolled course does not currently contain published learning material.</p>
              {lessons.length ? <div className="mt-4 flex md:hidden">{curriculumSheet}</div> : null}
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
