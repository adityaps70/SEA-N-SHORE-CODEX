import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, FileText, PlayCircle } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { LessonCompletionControl } from '@/features/learning/components/lesson-completion-control'
import { ResumableLessonMedia } from '@/features/learning/components/resumable-lesson-media'
import {
  learnerCourseRepository,
  type LearnerCourse,
  type LearnerLesson,
} from '@/features/learning/learner-course-repository'
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
  return lessons.find((lesson) => !lesson.completed) ?? lessons[0] ?? null
}

function lessonHref(slug: string, lessonId: string) {
  return `/learn/courses/${slug}/learn?lesson=${lessonId}`
}

function activityLabel(lesson: LearnerLesson) {
  return lesson.lessonType.replaceAll('_', ' ')
}

function unavailableActivityCopy(lesson: LearnerLesson) {
  if (lesson.lessonType === 'quiz') return 'The native quiz player is not connected yet.'
  if (lesson.lessonType === 'assignment') return 'The native assignment workspace is not connected yet.'
  if (lesson.lessonType === 'live_session') return 'The native live session experience is not connected yet.'
  return 'This lesson activity is recorded in the curriculum, but its native player is not connected yet.'
}

function shouldSignLessonAsset(lesson: LearnerLesson) {
  return !['article', 'quiz', 'assignment', 'live_session'].includes(lesson.lessonType)
}

function canManuallyCompleteLesson(lesson: LearnerLesson) {
  return !['quiz', 'assignment', 'live_session'].includes(lesson.lessonType)
}

function LessonContent({
  lesson,
  mediaUrl,
  slug,
}: {
  lesson: LearnerLesson
  mediaUrl: string | null
  slug: string
}) {
  if (lesson.lessonType === 'article') {
    return lesson.articleBody ? (
      <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
        {lesson.articleBody}
      </div>
    ) : (
      <p className="text-sm text-slate-500">This article does not have published content yet.</p>
    )
  }

  if (lesson.lessonType === 'quiz' || lesson.lessonType === 'assignment' || lesson.lessonType === 'live_session') {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6">
        <p className="text-sm font-medium text-slate-900">{unavailableActivityCopy(lesson)}</p>
        <p className="mt-2 text-sm text-slate-500">No activity content has been invented for this lesson.</p>
      </div>
    )
  }

  if (lesson.assetPath && mediaUrl) {
    if (lesson.lessonType === 'video' || lesson.lessonType === 'audio') {
      return (
        <ResumableLessonMedia
          key={lesson.id}
          kind={lesson.lessonType}
          src={mediaUrl}
          slug={slug}
          lessonId={lesson.id}
          initialPositionSeconds={lesson.lastPositionSeconds}
        />
      )
    }

    return (
      <a
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
        href={mediaUrl}
        target="_blank"
        rel="noreferrer"
      >
        <FileText className="h-4 w-4" />
        Open lesson resource
      </a>
    )
  }

  if (lesson.externalUrl) {
    return (
      <a
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
        href={lesson.externalUrl}
        target="_blank"
        rel="noreferrer"
      >
        <PlayCircle className="h-4 w-4" />
        Open lesson
      </a>
    )
  }

  return <p className="text-sm text-slate-500">This lesson does not have published media or content yet.</p>
}

export default async function LearnerCoursePage({ params, searchParams }: LearnerCoursePageProps) {
  const [{ slug }, query, user] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ lesson?: string }>({}),
    requireAwsUser(),
  ])

  const course = await learnerCourseRepository.getLearnerCourse(user.id, slug)
  if (!course) return notFound()

  const lessons = allLessons(course)
  const requestedLessonId = query.lesson
  const selectedLesson = requestedLessonId
    ? lessons.find((lesson) => lesson.id === requestedLessonId) ?? null
    : defaultLesson(course)

  if (requestedLessonId && !selectedLesson) return notFound()

  const selectedLessonIndex = selectedLesson
    ? lessons.findIndex((lesson) => lesson.id === selectedLesson.id)
    : -1
  const previousLesson = selectedLessonIndex > 0
    ? lessons[selectedLessonIndex - 1]
    : null
  const nextLesson = selectedLessonIndex >= 0 && selectedLessonIndex < lessons.length - 1
    ? lessons[selectedLessonIndex + 1]
    : null

  const selectedMediaUrl = selectedLesson?.assetPath && shouldSignLessonAsset(selectedLesson)
    ? await createMediaReadUrl(selectedLesson.assetPath)
    : null

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">My Learning · {course.category}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{course.title}</h1>
            {course.subtitle ? <p className="mt-3 text-base leading-7 text-slate-600">{course.subtitle}</p> : null}
            <p className="mt-3 text-sm text-slate-500">Mentored by {course.mentorName}</p>
          </div>

          <div className="min-w-56 rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">{course.completedLessons} of {course.totalLessons} lessons completed</span>
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
        <section
          aria-label="Course completed"
          className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm sm:p-8"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                Learning milestone reached
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Course completed</h2>
              <p className="mt-2 text-sm leading-6 text-slate-700">All {course.totalLessons} lessons are complete. You can continue reviewing any lesson from the curriculum below.</p>
              {course.certificateEnabled ? (
                <p className="mt-2 text-sm text-slate-600">Certificate issuance is not connected yet.</p>
              ) : null}
            </div>
            <Link
              href="/learn/my-learning"
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Back to My Learning
            </Link>
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <nav aria-label="Course curriculum" className="h-fit rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-6">
          <div className="px-2 pb-3">
            <h2 className="text-sm font-semibold text-slate-950">Course curriculum</h2>
            <p className="mt-1 text-xs text-slate-500">Your progress comes from completed lessons.</p>
          </div>

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
                        className={`flex items-start gap-3 rounded-xl px-3 py-3 text-sm transition ${
                          active ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {lesson.completed ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        ) : (
                          <Circle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        )}
                        <span>
                          <span className="block font-medium">{lesson.title}</span>
                          <span className={`mt-1 block text-xs capitalize ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                            {activityLabel(lesson)}{lesson.completed ? ' · Completed' : ''}
                          </span>
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </nav>

        <main>
          {selectedLesson ? (
            <section aria-label="Current lesson" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <span>{activityLabel(selectedLesson)}</span>
                {selectedLesson.durationSeconds ? <span>· {Math.ceil(selectedLesson.durationSeconds / 60)} min</span> : null}
                {selectedLesson.completed ? <span>· Completed</span> : null}
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{selectedLesson.title}</h2>
              {selectedLesson.summary ? <p className="mt-3 text-sm leading-6 text-slate-600">{selectedLesson.summary}</p> : null}

              <div className="mt-7">
                <LessonContent lesson={selectedLesson} mediaUrl={selectedMediaUrl} slug={course.slug} />
              </div>

              {canManuallyCompleteLesson(selectedLesson) ? (
                <div className="mt-7 border-t border-slate-200 pt-6">
                  <LessonCompletionControl
                    slug={course.slug}
                    lessonId={selectedLesson.id}
                    initiallyCompleted={selectedLesson.completed}
                    nextLessonHref={nextLesson ? lessonHref(course.slug, nextLesson.id) : null}
                  />
                </div>
              ) : null}

              {previousLesson || nextLesson ? (
                <nav aria-label="Lesson navigation" className="mt-7 flex items-center justify-between gap-3 border-t border-slate-200 pt-6">
                  <div>
                    {previousLesson ? (
                      <Link
                        href={lessonHref(course.slug, previousLesson.id)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                      >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        Previous lesson
                      </Link>
                    ) : null}
                  </div>
                  <div>
                    {nextLesson ? (
                      <Link
                        href={lessonHref(course.slug, nextLesson.id)}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                      >
                        Next lesson
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </nav>
              ) : null}
            </section>
          ) : (
            <section aria-label="Current lesson" className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-950">No lessons published yet</h2>
              <p className="mt-2 text-sm text-slate-500">This enrolled course does not currently contain published lesson content.</p>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
