import { MainLandmark } from '@/components/layout/main-landmark'
import type { Metadata } from 'next'
import { cache } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, LockKeyhole, PlayCircle } from 'lucide-react'
import { renderArticleHtml } from '@/features/learning/article-html'
import { MaterialBody } from '@/features/learning/components/material-player'
import type { LearnerLesson } from '@/features/learning/learner-course-repository'
import { publicCourseRepository, type PreviewLesson } from '@/features/learning/public-course-repository'
import { createMediaReadUrl } from '@/lib/aws/storage'
import { cdnImageSrc } from '@/lib/media-cdn/media-cdn'
import { courseVideoSource, type LessonMediaSource } from '@/features/learning/lesson-media-source'

type PreviewPageProps = {
  params: Promise<{ slug: string; lessonId: string }>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Only a free-preview material of a course open to new learners loads; anything else is a 404. */
const loadPreview = cache((slug: string, lessonId: string) =>
  UUID.test(lessonId) ? publicCourseRepository.getPreviewLesson(slug, lessonId) : Promise.resolve(null))

export async function generateMetadata({ params }: PreviewPageProps): Promise<Metadata> {
  const { slug, lessonId } = await params
  const preview = await loadPreview(slug, lessonId)
  if (!preview) return { title: 'Preview not found', robots: { index: false } }
  // The course page is the page for search; previews are for visitors deciding whether to enrol.
  return {
    title: `${preview.lesson.title} · ${preview.course.title}`,
    robots: { index: false, follow: true },
    alternates: { canonical: `/learn/courses/${preview.course.slug}` },
  }
}

/** The preview as the player's read model, with nothing recorded and nothing locked. */
function previewAsLesson({ lesson }: PreviewLesson): LearnerLesson {
  return {
    ...lesson,
    position: 0,
    isPreview: true,
    isPublished: true,
    releaseMode: 'immediate',
    releaseAt: null,
    dripDelayDays: null,
    prerequisiteLessonId: null,
    completionRule: 'view',
    completionThreshold: null,
    maxAttempts: null,
    isAvailable: true,
    lockReason: null,
    completed: false,
    completedAt: null,
    lastPositionSeconds: 0,
    viewedAt: null,
    mediaPercent: 0,
    attemptsUsed: 0,
    assignment: null,
    scorm: null,
    hasCaptions: lesson.lessonType === 'video' && Boolean(lesson.captionPath),
  }
}

async function previewMedia(assetPath: string | null, lessonType: string): Promise<LessonMediaSource | null> {
  if (!assetPath) return null
  if (lessonType === 'video') return courseVideoSource(assetPath, 'preview')
  return { url: (lessonType === 'image' ? cdnImageSrc(assetPath, 1600) : null) ?? await createMediaReadUrl(assetPath), expiresAt: null }
}

export default async function CoursePreviewPage({ params }: PreviewPageProps) {
  const { slug, lessonId } = await params
  const preview = await loadPreview(slug, lessonId)
  if (!preview) return notFound()

  const lesson = previewAsLesson(preview)
  const [media, articleHtml] = await Promise.all([
    // Round P3 (B7): image lessons and article images from their CDN size once it is configured, and a video
    // with a ready rendition from its signed MP4 and HLS playlist.
    previewMedia(lesson.assetPath, lesson.lessonType),
    lesson.articleFormat === 'html' && lesson.articleBody
      ? renderArticleHtml(lesson.articleBody, async (path) => cdnImageSrc(path, 1600) ?? createMediaReadUrl(path))
      : Promise.resolve(null),
  ])
  const coursePath = `/learn/courses/${preview.course.slug}`

  return (
    <MainLandmark className="mx-auto w-full max-w-page-narrow">
      <Link href={coursePath} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-ocean-700 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> {preview.course.title}
      </Link>

      <article className="mt-2 rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-7">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800">
          <PlayCircle aria-hidden="true" className="size-3.5" /> Free preview
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">{lesson.title}</h1>
        {lesson.summary ? <p className="mt-2 text-[15px] leading-7 text-muted">{lesson.summary}</p> : null}
        <div className="mt-5">
          <MaterialBody lesson={lesson} slug={preview.course.slug} mediaUrl={media?.url ?? null} mediaStream={media?.stream ?? null} quiz={null} articleHtml={articleHtml} preview />
        </div>
      </article>

      <section aria-label="Enrol to continue" className="mt-4 rounded-[1.5rem] bg-navy-950 p-5 text-white shadow-[var(--shadow-card)] sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-200" />
            <div>
              <h2 className="text-lg font-bold">Enrol to continue</h2>
              <p className="mt-1 text-sm leading-6 text-white/75">The rest of {preview.course.title}, its quizzes, assignments and certificate open once you enrol.</p>
            </div>
          </div>
          <Link href={`${coursePath}#course-access`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-5 text-sm font-bold text-navy-950 transition hover:bg-teal-50">
            See enrolment options
          </Link>
        </div>
      </section>
    </MainLandmark>
  )
}
