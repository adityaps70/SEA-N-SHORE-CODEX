/* eslint-disable @next/next/no-img-element -- Learner material images use short-lived signed S3 URLs. */

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ExternalLink, FileDown, LockKeyhole } from 'lucide-react'
import type { LearnerLesson } from '../learner-course-repository'
import type { LearnerQuiz } from '../learner-quiz-repository'
import { AssignmentActivity } from './assignment-activity'
import { LessonCompletionControl } from './lesson-completion-control'
import { QuizLessonActivity } from './quiz-lesson-activity'
import { ResumableLessonMedia } from './resumable-lesson-media'
import { ScormPlayer } from './scorm-player'
import { ViewCompletionBeacon } from './view-completion-beacon'

type Props = {
  lesson: LearnerLesson
  slug: string
  mediaUrl: string | null
  quiz: LearnerQuiz | null
  nextLessonHref?: string | null
  /** Phone-only controls shown beside Mark complete (the course player's "Curriculum n/N" button). */
  phoneActions?: ReactNode
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

function MaterialBody({ lesson, slug, mediaUrl, quiz, nextLessonHref }: Props) {
  switch (lesson.lessonType) {
    case 'article':
      return lesson.articleBody ? (
        <div className="whitespace-pre-wrap text-[15px] leading-8 text-navy-900">{lesson.articleBody}</div>
      ) : null

    case 'image':
      return mediaUrl ? (
        <figure className="overflow-hidden rounded-2xl border border-mist-200 bg-mist-50">
          <img src={mediaUrl} alt={lesson.title} className="max-h-[720px] w-full object-contain" />
        </figure>
      ) : null

    case 'video':
      return mediaUrl ? (
        <ResumableLessonMedia
          kind="video"
          src={mediaUrl}
          slug={slug}
          lessonId={lesson.id}
          initialPositionSeconds={lesson.lastPositionSeconds}
        />
      ) : lesson.externalUrl ? (
        <a href={lesson.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-800 transition-colors">
          Watch video <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      ) : null

    case 'audio':
      return mediaUrl ? (
        <ResumableLessonMedia
          kind="audio"
          src={mediaUrl}
          slug={slug}
          lessonId={lesson.id}
          initialPositionSeconds={lesson.lastPositionSeconds}
        />
      ) : null

    case 'pdf':
      return mediaUrl ? (
        <div>
          <iframe title={lesson.title} src={mediaUrl} className="min-h-[720px] w-full rounded-2xl border border-mist-200 bg-white max-md:hidden" />
          {/* Phones: a tall embedded PDF is hard to read, so open it in the browser's own viewer. */}
          <div className="rounded-2xl border border-mist-200 bg-mist-50 p-4 md:hidden">
            <p className="text-sm leading-6 text-muted">This PDF opens in a new tab so you can zoom and scroll comfortably.</p>
            <a href={mediaUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-ocean-700 px-5 text-[15px] font-bold text-white transition-colors hover:bg-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500">
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
          version={lesson.scorm.version}
          maxAttempts={lesson.maxAttempts}
          attemptsUsed={lesson.attemptsUsed}
          initiallyCompleted={lesson.completed}
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

export function MaterialPlayer(props: Props) {
  const { lesson, slug, nextLessonHref = null, phoneActions = null } = props
  if (!lesson.isAvailable) {
    return (
      <>
        <LockedMaterial lesson={lesson} />
        {phoneActions ? <div className="mt-6 flex md:hidden">{phoneActions}</div> : null}
      </>
    )
  }

  const showManualCompletion = lesson.completionRule === 'manual'
  const markViewed = lesson.completionRule === 'view'
  const completion = showManualCompletion ? (
    <LessonCompletionControl
      slug={slug}
      lessonId={lesson.id}
      initiallyCompleted={lesson.completed}
      nextLessonHref={nextLessonHref}
    />
  ) : lesson.completed && lesson.lessonType !== 'quiz' && lesson.lessonType !== 'assignment' && lesson.lessonType !== 'scorm' ? (
    <p className="text-sm font-bold text-emerald-700 max-md:self-center">Completed</p>
  ) : null

  return (
    <>
    <div className="space-y-6">
      {markViewed ? <ViewCompletionBeacon slug={slug} lessonId={lesson.id} alreadyCompleted={lesson.completed} /> : null}
      <MaterialBody {...props} />
      {lesson.completionRule === 'media_percentage' && !lesson.completed ? (
        <p className="text-xs font-medium text-muted">
          Completion is recorded automatically after {lesson.completionThreshold ?? 90}% of this media is played.
          {lesson.mediaPercent > 0 ? ` Current progress: ${lesson.mediaPercent}%.` : ''}
        </p>
      ) : null}
      {completion ? (
        // Desktop keeps the completion control on its own line; phones put the curriculum button beside it.
        <div className="max-md:flex max-md:flex-wrap max-md:items-start max-md:gap-3 max-md:[&>*]:flex-1">
          {phoneActions}
          {completion}
        </div>
      ) : null}
      {nextLessonHref && lesson.completed && lesson.lessonType !== 'quiz' ? (
        // Phones have one "Next material" pill in the lesson navigation below instead.
        <Link href={nextLessonHref} className="inline-flex text-sm font-bold text-teal-700 hover:text-teal-800 max-md:hidden">Continue to next material →</Link>
      ) : null}
    </div>
    {/* Outside the space-y column so a phone-only last child never adds desktop spacing. */}
    {!completion && phoneActions ? <div className="mt-6 flex md:hidden">{phoneActions}</div> : null}
    </>
  )
}
