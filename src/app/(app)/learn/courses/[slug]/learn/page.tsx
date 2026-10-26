import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { BookOpen, CheckCircle2, ChevronRight, GraduationCap } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { coursePaymentRepository } from '@/features/learning/course-payment-repository'
import { CourseCurriculumSheet } from '@/features/learning/components/course-curriculum-sheet'
import { CurriculumAccordion, type CurriculumModuleView } from '@/features/learning/components/curriculum-accordion'
import { LessonActionBar } from '@/features/learning/components/lesson-action-bar'
import { MaterialPlayer } from '@/features/learning/components/material-player'
import { PageActionsSheet } from '@/features/learning/components/page-actions-sheet'
import {
  learnerCourseRepository,
  type LearnerCourse,
  type LearnerLesson,
} from '@/features/learning/learner-course-repository'
import { curriculumLessons, defaultPlayerLesson } from '@/features/learning/next-lesson'
import { learnerQuizRepository } from '@/features/learning/learner-quiz-repository'
import { createLessonMediaUrl, createMediaReadUrl } from '@/lib/aws/storage'
import { renderArticleHtml } from '@/features/learning/article-html'
import { FocusModeToggle, FocusSidebarToggle, PlayerShell, SidebarRailToggle } from '@/features/learning/components/player-shell'
import { lessonTypeLabel } from '@/features/learning/lesson-type-labels'
import { moduleCrumb } from '@/features/learning/module-label'
import { readingMinutes } from '@/features/learning/reading-time'
import { isFullHeightScormLesson, lessonDurationLabel } from '@/features/learning/scorm-lesson-layout'
import { courseAnnouncementRepository, type CourseAnnouncement } from '@/features/learning/course-announcement-repository'
import { courseCommunityRepository } from '@/features/learning/course-community-repository'
import { courseRatingRepository } from '@/features/learning/course-rating-repository'
import { CourseAnnouncementsList } from '@/features/learning/components/course-announcements-list'
import { CourseDiscussButton } from '@/features/learning/components/course-discuss-button'
import { CourseRatingWidget } from '@/features/learning/components/course-rating-widget'
import { PlayerTabs } from '@/features/learning/components/player-tabs'
import { sessionRepository } from '@/features/learning/sessions/session-repository'
import { LearnerSessionsPanel } from '@/features/learning/sessions/components/learner-sessions-panel'
import { DeviceTimeZoneSync } from '@/features/learning/sessions/components/device-time-zone-sync'
import { cdnImageSrc } from '@/lib/media-cdn/media-cdn'

type LearnerCoursePageProps = {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ lesson?: string; tab?: string; join?: string }>
}

function lessonHref(slug: string, lessonId: string) {
  return `/learn/courses/${slug}/learn?lesson=${lessonId}`
}

function lessonMeta(lesson: LearnerLesson) {
  // Articles show their reading time from the text (round E), other materials the trainer's duration.
  if (lesson.lessonType === 'article' && lesson.articleBody) {
    return `${lessonTypeLabel(lesson.lessonType)} · ${readingMinutes(lesson.articleBody, lesson.articleFormat === 'html' ? 'html' : 'plain')} min read`
  }
  const minutes = lesson.durationSeconds ? ` · ${Math.max(1, Math.round(lesson.durationSeconds / 60))} min` : ''
  return `${lessonTypeLabel(lesson.lessonType)}${minutes}`
}

function shouldSignLessonAsset(lesson: LearnerLesson) {
  return lesson.isAvailable
    && Boolean(lesson.assetPath)
    && !['article', 'quiz', 'assignment', 'external_embed', 'scorm', 'live_session'].includes(lesson.lessonType)
}

/**
 * Round E: the video watermark. There is no member number, so it is a short code from the profile id plus
 * today's date. It never shows a name, email or username.
 */
function videoWatermark(profileId: string, now = new Date()) {
  const code = `SNS-${profileId.replace(/-/g, '').slice(0, 8).toUpperCase()}`
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(now)
  return `${code} · ${date}`
}

/** One load per request, shared by the page and its metadata (the tab title). */
const loadCourse = cache(async (slug: string) => {
  const user = await requireAwsUser()
  return { user, course: await learnerCourseRepository.getLearnerCourse(user.id, slug) }
})

function selectLesson(course: LearnerCourse, requestedLessonId: string | undefined) {
  const lessons = curriculumLessons(course)
  const selected = requestedLessonId
    ? lessons.find((lesson) => lesson.id === requestedLessonId) ?? null
    : defaultPlayerLesson(lessons)
  return { lessons, selected }
}

export async function generateMetadata({ params, searchParams }: LearnerCoursePageProps): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams ?? Promise.resolve<{ lesson?: string }>({})])
  try {
    const { course } = await loadCourse(slug)
    if (!course) return { title: 'Course' }
    const { selected } = selectLesson(course, query.lesson)
    // "<Lesson title> · <Course title> | Sea N Shore" (the root layout adds the site name).
    return { title: selected ? `${selected.title} · ${course.title}` : course.title }
  } catch {
    return { title: 'Course' }
  }
}

/** Phones: course progress sits under the lesson title (the sidebar is in the curriculum sheet). */
function PhoneCourseProgress({ percent, completed, total }: { percent: number; completed: number; total: number }) {
  return (
    <div className="mt-3 lg:hidden">
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-mist-100">
        <div className="h-full rounded-full bg-teal-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1.5 text-meta text-muted">{percent}% complete · {completed} of {total}</p>
    </div>
  )
}

function CourseProgressBar({ course }: { course: LearnerCourse }) {
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-mist-100"
      role="progressbar"
      aria-label={`${course.title} progress`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={course.progressPercent}
    >
      <div className="h-full rounded-full bg-teal-500" style={{ width: `${course.progressPercent}%` }} />
    </div>
  )
}

export default async function LearnerCoursePage({ params, searchParams }: LearnerCoursePageProps) {
  const [{ slug }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ lesson?: string; tab?: string; join?: string }>({}),
  ])
  const { user, course } = await loadCourse(slug)
  if (!course) return notFound()
  // Course team access (no purchase) lasts only while the person is still on the team.
  if (course.enrollmentSource === 'admin') {
    const stillOnTeam = await coursePaymentRepository.isCourseManager(user.id, course.courseId)
      || await canAccessPlatformAdmin(user.id)
    if (!stillOnTeam) return redirect(`/learn/courses/${course.slug}`)
  }

  const { lessons, selected: selectedLesson } = selectLesson(course, query.lesson)
  if (query.lesson && !selectedLesson) return notFound()

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
  // Round E: video and audio get a short-lived (20 minute) inline URL that the player refreshes on its own.
  const selectedMedia = selectedLesson?.assetPath && shouldSignLessonAsset(selectedLesson)
    ? selectedLesson.lessonType === 'video' || selectedLesson.lessonType === 'audio'
      ? await createLessonMediaUrl(selectedLesson.assetPath)
      // Round P3 (B7): lesson images from their CDN size once the media CDN is configured.
      : { url: (selectedLesson.lessonType === 'image' ? cdnImageSrc(selectedLesson.assetPath, 1600) : null) ?? await createMediaReadUrl(selectedLesson.assetPath), expiresAt: null }
    : null
  const selectedArticleHtml = selectedLesson?.isAvailable && selectedLesson.articleFormat === 'html' && selectedLesson.articleBody
    ? await renderArticleHtml(selectedLesson.articleBody, async (path) => cdnImageSrc(path, 1600) ?? createMediaReadUrl(path))
    : null
  // Learning round C: rating, announcements and the course community. Conveniences: the player works without them.
  // Round D: the learner's live sessions when they are in a batch (a convenience: the player works without it).
  const batchSessions = await sessionRepository.listForLearner(user.id, course.courseId).catch(() => null)
  const attendanceRule = batchSessions?.minAttendancePercent !== null && batchSessions?.minAttendancePercent !== undefined
    ? await sessionRepository.certificateAttendance(user.id, course.courseId).catch(() => null)
    : null
  const [ratingEligibility, announcements, discussion] = await Promise.all([
    courseRatingRepository.getEligibility(user.id, course.courseId).catch(() => null),
    courseAnnouncementRepository.listForLearner(user.id, course.courseId).catch(() => null),
    courseCommunityRepository.getDiscussion(course.courseId).catch(() => null),
  ])
  const courseAnnouncements: CourseAnnouncement[] = announcements ?? []
  const discussButton = discussion ? <CourseDiscussButton courseId={course.courseId} communityName={discussion.name} /> : null

  // Round E (E1): the curriculum as an accordion, shared by the desktop sidebar and the phone sheet.
  const lessonTitles = new Map(lessons.map((lesson) => [lesson.id, lesson.title]))
  const curriculumModules: CurriculumModuleView[] = course.sections.map((section) => ({
    id: section.id,
    title: section.title,
    done: section.lessons.filter((lesson) => lesson.completed).length,
    items: section.lessons.map((lesson) => {
      const prerequisite = !lesson.completed && lesson.prerequisiteLessonId ? lessonTitles.get(lesson.prerequisiteLessonId) ?? null : null
      return {
        id: lesson.id,
        title: lesson.title,
        href: lessonHref(course.slug, lesson.id),
        meta: lessonMeta(lesson),
        status: lesson.completed ? 'completed' : lesson.isAvailable ? 'available' : 'locked',
        statusLabel: lesson.completed ? 'Completed' : lesson.isAvailable ? null : 'Locked',
        note: prerequisite ? `After “${prerequisite}”` : null,
      }
    }),
  }))
  const selectedModuleIndex = selectedLesson
    ? course.sections.findIndex((section) => section.lessons.some((lesson) => lesson.id === selectedLesson.id))
    : -1
  const lessonPosition = selectedLessonIndex + 1
  const curriculumSheet = (
    <CourseCurriculumSheet
      position={lessonPosition}
      total={lessons.length}
      modules={curriculumModules}
      currentItemId={selectedLesson?.id ?? null}
      storageKey={course.slug}
    />
  )
  const sequentialNote = course.navigationMode === 'sequential' ? 'Lessons unlock in order.' : null
  // S2: a ready SCORM package fills the window (compact header, no page scroll); other lessons are unchanged.
  const scormLayout = isFullHeightScormLesson(selectedLesson)
  const ratingWidget = ratingEligibility ? <CourseRatingWidget courseId={course.courseId} eligibility={ratingEligibility} /> : null

  const breadcrumb = selectedLesson && selectedModuleIndex >= 0 ? (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1 max-md:hidden">
      <ol className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
        <li className="min-w-0 max-w-[45%] shrink-0 truncate">{moduleCrumb(selectedModuleIndex, course.sections[selectedModuleIndex]?.title ?? '')}</li>
        <li aria-hidden="true"><ChevronRight className="size-3.5" /></li>
        <li className="min-w-0 truncate font-semibold text-navy-900" aria-current="page">{selectedLesson.title}</li>
      </ol>
    </nav>
  ) : <span className="flex-1 max-md:hidden" />

  return (
    <div
      className={scormLayout
        // S2: the lesson bar sits in the flow (no space kept for a fixed bar) and most of the app layout's
        // vertical padding is taken back, so header, frame and bar fit the window.
        ? 'mx-auto w-full max-w-page-wide px-4 max-md:-mb-4 max-md:flex max-md:flex-col max-md:px-0 sm:px-6 md:-my-4 lg:px-8'
        : 'mx-auto w-full max-w-page-wide px-4 py-2 max-md:flex max-md:flex-col max-md:px-0 max-md:py-0 max-md:pb-32 sm:px-6 lg:px-8'}
    >
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
      <PlayerShell focusModeAvailable={!scormLayout} className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-6 lg:data-[sidebar=hidden]:grid-cols-[minmax(0,1fr)] lg:data-[sidebar=rail]:grid-cols-[64px_minmax(0,1fr)]">
        {/* Desktop sidebar (round E): the course block, then the curriculum, scrolling on its own. */}
        <aside
          aria-label="Course"
          className="flex flex-col overflow-hidden rounded-3xl border border-mist-200 bg-white shadow-sm max-lg:hidden lg:sticky lg:top-22 lg:max-h-[calc(100dvh-7rem)] group-data-[focus=on]/player:lg:top-4 group-data-[focus=on]/player:lg:max-h-[calc(100dvh-2rem)] group-data-[sidebar=hidden]/player:hidden"
        >
          <div className="border-b border-mist-100 p-5 group-data-[sidebar=rail]/player:hidden">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-card-title font-bold text-navy-950">{course.title}</h2>
              <SidebarRailToggle collapsed={false} className="-mr-2 -mt-1 shrink-0" />
            </div>
            <p className="mt-1 text-meta text-muted">Mentored by {course.mentorName}</p>
            <div className="mt-4 flex items-center justify-between gap-3 text-meta">
              <span className="text-navy-800">{course.completedLessons} of {course.totalLessons} · {course.progressPercent}%</span>
            </div>
            <div className="mt-2"><CourseProgressBar course={course} /></div>
            {discussButton ? <div className="mt-4">{discussButton}</div> : null}
          </div>
          <div data-curriculum-scroll="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 group-data-[sidebar=rail]/player:hidden">
            {sequentialNote ? <p className="px-2 pb-2 text-meta text-muted">{sequentialNote}</p> : null}
            <nav aria-label="Course curriculum">
              <CurriculumAccordion modules={curriculumModules} currentItemId={selectedLesson?.id ?? null} storageKey={course.slug} />
            </nav>
          </div>
          {/* Collapsed rail: progress and a button to expand. */}
          <div className="hidden flex-col items-center gap-3 py-4 group-data-[sidebar=rail]/player:flex">
            <SidebarRailToggle collapsed />
            <span className="text-meta font-semibold text-navy-900" aria-label={`${course.progressPercent}% complete`}>{course.progressPercent}%</span>
            <div aria-hidden="true" className="h-24 w-1.5 overflow-hidden rounded-full bg-mist-100">
              <div className="w-full rounded-full bg-teal-500" style={{ height: `${course.progressPercent}%` }} />
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          {course.accessExpired ? (
            <section aria-label="Access ended" className="mb-4 rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm max-md:m-4 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-card-title font-bold text-amber-950">
                    Your access ended{course.accessExpiresAt ? ` on ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(course.accessExpiresAt))}` : ''}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-amber-900">The course is read-only: your progress, results and certificate are kept. Renew to open the materials again.</p>
                </div>
                <Link href={`/learn/courses/${course.slug}#renew`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800">
                  Renew access
                </Link>
              </div>
            </section>
          ) : null}

          {course.enrollmentStatus === 'completed' ? (
            <section aria-label="Course completed" className="mb-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm max-md:order-last max-md:m-4 max-md:p-5">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Learning milestone reached
                  </div>
                  <h2 className="mt-2 text-section-title font-bold text-navy-950">Course completed</h2>
                  <p className="mt-2 text-sm leading-6 text-navy-800">All {course.totalLessons} published materials are complete. You can continue reviewing the curriculum.</p>
                  {course.certificateEnabled ? <p className="mt-2 text-sm text-navy-700">Your eligible Sea N Shore certificate is issued from the completed enrollment.</p> : null}
                  {course.certificateEnabled && attendanceRule && attendanceRule.attended * 100 < attendanceRule.required * attendanceRule.total ? (
                    <p className="mt-2 text-sm font-semibold text-amber-900">
                      Attend at least {attendanceRule.required}% of live sessions for your certificate (now {attendanceRule.percent}%: {attendanceRule.attended} of {attendanceRule.total}).
                    </p>
                  ) : null}
                </div>
                <Link href="/learn/my-learning" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800">
                  Back to My Learning
                </Link>
              </div>
            </section>
          ) : null}

          {batchSessions ? <DeviceTimeZoneSync /> : null}
          <PlayerTabs
            initialTab={query.tab === 'announcements' ? 'announcements' : query.tab === 'sessions' ? 'sessions' : 'lesson'}
            announcementCount={courseAnnouncements.length}
            sessions={batchSessions ? <LearnerSessionsPanel data={batchSessions} joinNotice={query.join ?? null} /> : undefined}
            // S2: on a full-height SCORM lesson the breadcrumb and Focus mode live in the package's own header.
            leading={scormLayout ? <span className="flex-1 max-md:hidden" /> : breadcrumb}
            trailing={scormLayout ? null : (
              <div className="flex items-center gap-1 max-md:hidden">
                <FocusSidebarToggle />
                <FocusModeToggle />
              </div>
            )}
            compact={scormLayout}
            lesson={(
              <>
                {selectedLesson && scormLayout ? (
                  <section
                    aria-label="Current lesson"
                    data-scorm-lesson=""
                    className="rounded-3xl border border-mist-200 bg-white shadow-sm max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:shadow-none"
                  >
                    {/* The package shows its own title; the compact header carries the breadcrumb and duration. */}
                    <h1 className="sr-only">{selectedLesson.title}</h1>
                    {selectedLesson.summary ? <p className="sr-only">{selectedLesson.summary}</p> : null}
                    <MaterialPlayer
                      lesson={selectedLesson}
                      mediaUrl={null}
                      mediaExpiresAt={null}
                      watermark={null}
                      slug={course.slug}
                      quiz={null}
                      articleHtml={null}
                      scormHeader={{
                        crumb: selectedModuleIndex >= 0 ? moduleCrumb(selectedModuleIndex, course.sections[selectedModuleIndex]?.title ?? '') : null,
                        title: selectedLesson.title,
                        duration: lessonDurationLabel(selectedLesson),
                      }}
                    />
                    <LessonActionBar
                      slug={course.slug}
                      lessonId={selectedLesson.id}
                      completionRule={selectedLesson.completionRule}
                      completionThreshold={selectedLesson.completionThreshold}
                      completed={selectedLesson.completed}
                      available={selectedLesson.isAvailable}
                      previousHref={previousLesson ? lessonHref(course.slug, previousLesson.id) : null}
                      nextHref={nextLesson ? lessonHref(course.slug, nextLesson.id) : null}
                      finishHref="/learn/my-learning"
                      phoneStart={curriculumSheet}
                      docked={false}
                    />
                  </section>
                ) : selectedLesson ? (
                  <section aria-label="Current lesson" className="rounded-3xl border border-mist-200 bg-white p-6 pb-0 shadow-sm max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:shadow-none sm:p-8 sm:pb-0">
                    <p className="text-meta text-muted">
                      <span className="md:hidden">Lesson {lessonPosition} of {lessons.length} · </span>
                      {lessonMeta(selectedLesson)}
                      {selectedLesson.completed ? ' · Completed' : !selectedLesson.isAvailable ? ' · Locked' : ''}
                    </p>
                    <h1 className="mt-1 text-page-title font-bold text-navy-950 max-md:text-[1.5rem] max-md:leading-8">{selectedLesson.title}</h1>
                    <PhoneCourseProgress percent={course.progressPercent} completed={course.completedLessons} total={course.totalLessons} />
                    {selectedLesson.summary ? <p className="mt-3 text-body text-navy-800">{selectedLesson.summary}</p> : null}

                    <div className="mt-6 max-md:mt-5">
                      <MaterialPlayer
                        lesson={selectedLesson}
                        mediaUrl={selectedMedia?.url ?? null}
                        mediaExpiresAt={selectedMedia?.expiresAt ?? null}
                        watermark={selectedLesson.lessonType === 'video' ? videoWatermark(user.id) : null}
                        slug={course.slug}
                        quiz={selectedQuiz}
                        articleHtml={selectedArticleHtml}
                      />
                    </div>

                    <LessonActionBar
                      slug={course.slug}
                      lessonId={selectedLesson.id}
                      completionRule={selectedLesson.completionRule}
                      completionThreshold={selectedLesson.completionThreshold}
                      completed={selectedLesson.completed}
                      available={selectedLesson.isAvailable}
                      previousHref={previousLesson ? lessonHref(course.slug, previousLesson.id) : null}
                      nextHref={nextLesson ? lessonHref(course.slug, nextLesson.id) : null}
                      finishHref="/learn/my-learning"
                      phoneStart={curriculumSheet}
                    />
                  </section>
                ) : (
                  <section aria-label="Current lesson" className="rounded-3xl border border-mist-200 bg-white p-8 shadow-sm">
                    <h1 className="text-section-title font-bold text-navy-950">No materials published yet</h1>
                    <p className="mt-2 text-sm text-muted">This enrolled course does not currently contain published learning material.</p>
                    {lessons.length ? <div className="mt-4 flex lg:hidden">{curriculumSheet}</div> : null}
                  </section>
                )}
                {/* S2: nothing under a full-height SCORM lesson (the page must not scroll): rating moves to the
                    Announcements tab, and Discuss is already there and in the sidebar. */}
                {scormLayout ? null : ratingWidget}
                {discussButton && !scormLayout ? <div className="mt-2 border-t border-mist-200 px-4 py-4 lg:hidden">{discussButton}</div> : null}
              </>
            )}
            announcements={(
              <>
              <section aria-label="Course announcements" className="rounded-3xl border border-mist-200 bg-white p-6 shadow-sm max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:shadow-none sm:p-8">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-section-title font-bold text-navy-950">Announcements</h2>
                    <p className="mt-1 text-sm text-muted">News from {course.mentorName} for everyone in this course, newest first.</p>
                  </div>
                  {discussButton}
                </div>
                <div className="mt-5">
                  <CourseAnnouncementsList announcements={courseAnnouncements} />
                </div>
              </section>
              {scormLayout ? ratingWidget : null}
              </>
            )}
          />
        </div>
      </PlayerShell>
    </div>
  )
}
