/* eslint-disable @next/next/no-img-element -- Learner material images use short-lived signed S3 URLs. */

import { ExternalLink, FileDown, LockKeyhole } from 'lucide-react'
import type { LearnerLesson } from '../learner-course-repository'
import type { LearnerQuiz } from '../learner-quiz-repository'
import { readingMinutes } from '../reading-time'
import { ArticleReader } from './article-reader'
import { AssignmentActivity } from './assignment-activity'
import { QuizLessonActivity } from './quiz-lesson-activity'
import { ResumableLessonMedia } from './resumable-lesson-media'
import { ScormPlayer, type ScormLessonHeader } from './scorm-player'
import { ViewCompletionBeacon } from './view-completion-beacon'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'

type Props = {
  lesson: LearnerLesson
  slug: string
  mediaUrl: string | null
  quiz: LearnerQuiz | null
  nextLessonHref?: string | null
  /** A rich-text article, already sanitized on the server with its images signed (renderArticleHtml). */
  articleHtml?: string | null
  /** Free preview for a visitor: read or watch only; nothing is recorded. */
  preview?: boolean
  /** Round E: when the signed video/audio URL expires (the player refreshes it shortly before). */
  mediaExpiresAt?: string | null
  /** Round E: the faint video watermark (member code and date; never a name or email). */
  watermark?: string | null
  /** S2: a SCORM lesson's compact header (breadcrumb and duration), drawn by the player above the package. */
  scormHeader?: ScormLessonHeader | null
}

function safeEmbedUrl(url: string, kind: LearnerLesson['embedKind']) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (kind === 'youtube') {
      const host = parsed.hostname.replace(/^www\./, '')
      if (host === 'youtu.be') {
        const id = parsed.pathname.split('/').filter(Boolean)[0]
        return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null
      }
      if (host === 'youtube.com' || host === 'm.youtube.com') {
        const id = parsed.searchParams.get('v') ?? parsed.pathname.match(/^\/embed\/([^/]+)/)?.[1]
        return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null
      }
      return null
    }
    if (kind === 'vimeo') {
      const host = parsed.hostname.replace(/^www\./, '')
      if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null
      const id = parsed.pathname.split('/').filter(Boolean).find((part) => /^\d+$/.test(part))
      return id ? `https://player.vimeo.com/video/${id}` : null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function LockedMaterial({ lesson }: { lesson: LearnerLesson }) {
  const reason = lesson.lockReason === 'scheduled'
    ? lesson.releaseAt
      ? `Scheduled release: ${new Date(lesson.releaseAt).toLocaleString()}`
      : 'This material has a scheduled release.'
    : lesson.lockReason === 'drip'
      ? `Drip after enrollment: available ${lesson.dripDelayDays ?? 0} day${lesson.dripDelayDays === 1 ? '' : 's'} after enrollment.`
      : lesson.lockReason === 'prerequisite'
        ? 'Complete the required earlier material before continuing.'
        : lesson.lockReason === 'access_expired'
          ? 'Your access to this course has ended. Your progress, results and certificate are kept: renew from the course page to continue.'
          : 'This material is not available yet.'

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
      <div className="flex items-start gap-3">
        <LockKeyhole className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden="true" />
        <div>
          <p className="font-bold text-amber-950">Material locked</p>
          <p className="mt-1 text-sm leading-6 text-amber-900">{reason}</p>
        </div>
      </div>
    </div>
  )
}

/** The material itself (no completion controls). Also used on its own for free previews. */
export function MaterialBody({ lesson, slug, mediaUrl, quiz, nextLessonHref, articleHtml, preview = false, mediaExpiresAt = null, watermark = null, scormHeader = null }: Props) {
  switch (lesson.lessonType) {
    case 'article': {
      // Round E (E5): a readable measure (68ch) at the article size (17/30), with the reading time.
      if (lesson.articleFormat === 'html') {
        if (!articleHtml) return null
        // Sanitized with an allow-list on the server (article-html.ts) immediately before rendering.
        const article = <div className="lesson-article max-w-[68ch]" dangerouslySetInnerHTML={{ __html: articleHtml }} />
        return preview ? article : <ArticleReader minutes={readingMinutes(articleHtml, 'html')}>{article}</ArticleReader>
      }
      if (!lesson.articleBody) return null
      const plain = <div className="lesson-article max-w-[68ch] whitespace-pre-wrap">{lesson.articleBody}</div>
      return preview ? plain : <ArticleReader minutes={readingMinutes(lesson.articleBody, 'plain')}>{plain}</ArticleReader>
    }

    case 'image':
      return mediaUrl ? (
        <figure className="overflow-hidden rounded-2xl border border-mist-200 bg-mist-50">
          <img src={mediaUrl} alt={lesson.title} className="max-h-[720px] w-full object-contain" />
        </figure>
      ) : null

    case 'video':
      if (preview && mediaUrl) {
        return (
          <video controls controlsList="nodownload noremoteplayback" disableRemotePlayback preload="metadata" src={mediaUrl} className="aspect-video w-full rounded-2xl bg-navy-950">
            {lesson.hasCaptions ? <track kind="captions" src={`/api/learn/captions/${lesson.id}`} srcLang="en" label="Captions" default /> : null}
          </video>
        )
      }
      return mediaUrl ? (
        <ResumableLessonMedia
          key={lesson.id}
          kind="video"
          src={mediaUrl}
          slug={slug}
          lessonId={lesson.id}
          initialPositionSeconds={lesson.lastPositionSeconds}
          initialFurthestSeconds={lesson.furthestPositionSeconds ?? 0}
          initialWatchedSeconds={lesson.watchedSeconds ?? 0}
          completed={lesson.completed}
          captionsSrc={lesson.hasCaptions ? `/api/learn/captions/${lesson.id}` : null}
          expiresAt={mediaExpiresAt}
          watermark={watermark}
        />
      ) : lesson.externalUrl ? (
        <a href={lesson.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-800 transition-colors">
          Watch video <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      ) : null

    case 'audio':
      if (preview && mediaUrl) return <audio controls controlsList="nodownload noremoteplayback" preload="metadata" src={mediaUrl} className="w-full" />
      return mediaUrl ? (
        <ResumableLessonMedia
          key={lesson.id}
          kind="audio"
          src={mediaUrl}
          slug={slug}
          lessonId={lesson.id}
          initialPositionSeconds={lesson.lastPositionSeconds}
          initialFurthestSeconds={lesson.furthestPositionSeconds ?? 0}
          initialWatchedSeconds={lesson.watchedSeconds ?? 0}
          completed={lesson.completed}
          expiresAt={mediaExpiresAt}
        />
      ) : null

    case 'pdf':
      return mediaUrl ? (
        <div>
          <iframe title={lesson.title} src={mediaUrl} className="min-h-[720px] w-full rounded-2xl border border-mist-200 bg-white max-md:hidden" />
          {/* Phones: a tall embedded PDF is hard to read, so open it in the browser's own viewer. */}
          <div className="rounded-2xl border border-mist-200 bg-mist-50 p-4 md:hidden">
            <p className="text-sm leading-6 text-muted">This PDF opens in a new tab so you can zoom and scroll comfortably.</p>
            <a href={mediaUrl} target="_blank" rel="noreferrer" className={cn(buttonClass(), 'mt-3 min-h-11 rounded-full text-[15px] font-bold')}>
              Open PDF <ExternalLink className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      ) : null

    case 'presentation_document':
      return mediaUrl ? (
        <div className="rounded-2xl border border-mist-200 bg-mist-50 p-5">
          <p className="text-sm leading-6 text-muted">This document is ready for study in a new tab.</p>
          <a href={mediaUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-800 transition-colors">
            View document <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </div>
      ) : null

    case 'downloadable_resource':
      return mediaUrl ? (
        <a href={mediaUrl} download className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50">
          <FileDown className="size-4" aria-hidden="true" /> Download resource
        </a>
      ) : null

    case 'external_embed': {
      const embedUrl = lesson.externalUrl ? safeEmbedUrl(lesson.externalUrl, lesson.embedKind) : null
      return embedUrl ? (
        <iframe
          title={lesson.title}
          src={embedUrl}
          className="aspect-video w-full rounded-2xl border border-mist-200 bg-black"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
      ) : null
    }

    case 'quiz':
      return quiz ? (
        <QuizLessonActivity
          quiz={quiz}
          slug={slug}
          lessonId={lesson.id}
          initiallyCompleted={lesson.completed}
          nextLessonHref={nextLessonHref}
        />
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">This assessment is not ready yet.</p>
      )

    case 'assignment':
      return lesson.assignment ? (
        <AssignmentActivity
          slug={slug}
          lessonId={lesson.id}
          instructions={lesson.assignment.instructions}
          acceptedExtensions={lesson.assignment.acceptedExtensions}
          maxUploadBytes={lesson.assignment.maxUploadBytes}
          maxAttempts={lesson.maxAttempts}
          attemptsUsed={lesson.attemptsUsed}
          initiallyCompleted={lesson.completed}
        />
      ) : null

    case 'scorm':
      return lesson.scorm?.status === 'ready' && lesson.scorm.version && lesson.scorm.launchPath ? (
        <ScormPlayer
          slug={slug}
          lessonId={lesson.id}
          launchPath={lesson.scorm.launchPath}
          contentToken={lesson.scorm.contentToken ?? null}
          version={lesson.scorm.version}
          maxAttempts={lesson.maxAttempts}
          attemptsUsed={lesson.attemptsUsed}
          initiallyCompleted={lesson.completed}
          header={scormHeader}
        />
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {lesson.scorm?.status === 'error' ? 'This SCORM package needs mentor attention.' : 'This SCORM package is still being prepared.'}
        </p>
      )

    case 'live_session':
      return lesson.externalUrl ? (
        <a href={lesson.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-800 transition-colors">
          Join live session <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      ) : null
  }
}

/**
 * A lesson in the course player: the material, plus the automatic completion for "view" lessons.
 * Completing and moving on live in the player's one bottom bar (LessonActionBar, round E).
 */
export function MaterialPlayer(props: Props) {
  const { lesson, slug } = props
  if (!lesson.isAvailable) return <LockedMaterial lesson={lesson} />

  return (
    <div className="space-y-6">
      {lesson.completionRule === 'view' ? <ViewCompletionBeacon slug={slug} lessonId={lesson.id} alreadyCompleted={lesson.completed} /> : null}
      <MaterialBody {...props} />
      {lesson.completionRule === 'media_percentage' && !lesson.completed ? (
        <p className="text-meta text-muted">
          Completion is recorded automatically after {lesson.completionThreshold ?? 90}% of this media is played.
          {lesson.mediaPercent > 0 ? ` Current progress: ${lesson.mediaPercent}%.` : ''}
        </p>
      ) : null}
    </div>
  )
}
