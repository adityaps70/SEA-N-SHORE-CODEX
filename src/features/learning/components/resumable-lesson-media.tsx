'use client'

import { useCallback, useRef } from 'react'
import { saveLearningPlaybackPosition } from '../learner-progress-actions'

type ResumableLessonMediaProps = {
  kind: 'video' | 'audio'
  src: string
  slug: string
  lessonId: string
  initialPositionSeconds: number
}

const CHECKPOINT_SECONDS = 15

function wholeSeconds(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

export function ResumableLessonMedia({
  kind,
  src,
  slug,
  lessonId,
  initialPositionSeconds,
}: ResumableLessonMediaProps) {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const lastPersistedPositionRef = useRef(wholeSeconds(initialPositionSeconds))
  const queuedPositionRef = useRef<{ position: number; duration?: number } | null>(null)
  const savingRef = useRef(false)

  const flushQueuedPosition = useCallback(() => {
    if (savingRef.current) return
    savingRef.current = true

    void (async () => {
      try {
        while (queuedPositionRef.current !== null) {
          const next = queuedPositionRef.current
          queuedPositionRef.current = null

          if (next.position === lastPersistedPositionRef.current) continue

          const result = await saveLearningPlaybackPosition(slug, lessonId, next.position, next.duration)
          if (result.ok) {
            lastPersistedPositionRef.current = wholeSeconds(result.lastPositionSeconds)
          }
        }
      } finally {
        savingRef.current = false
      }
    })()
  }, [lessonId, slug])

  const queuePosition = useCallback((positionSeconds: number, durationSeconds?: number) => {
    const normalizedPosition = wholeSeconds(positionSeconds)
    if (normalizedPosition === lastPersistedPositionRef.current && queuedPositionRef.current === null) return

    queuedPositionRef.current = {
      position: normalizedPosition,
      duration: durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds
        : undefined,
    }
    flushQueuedPosition()
  }, [flushQueuedPosition])

  const setMediaRef = useCallback((node: HTMLMediaElement | null) => {
    mediaRef.current = node
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    const media = mediaRef.current
    if (!media) return

    const persistedPosition = wholeSeconds(initialPositionSeconds)
    if (persistedPosition <= 0) return

    const duration = media.duration
    media.currentTime = Number.isFinite(duration) && duration >= 0
      ? Math.min(persistedPosition, duration)
      : persistedPosition
  }, [initialPositionSeconds])

  const handleTimeUpdate = useCallback(() => {
    const media = mediaRef.current
    if (!media) return

    const currentPosition = wholeSeconds(media.currentTime)
    if (Math.abs(currentPosition - lastPersistedPositionRef.current) < CHECKPOINT_SECONDS) return
    queuePosition(currentPosition, media.duration)
  }, [queuePosition])

  const handlePause = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    queuePosition(media.currentTime, media.duration)
  }, [queuePosition])

  const handleEnded = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    queuePosition(media.duration || media.currentTime, media.duration)
  }, [queuePosition])

  const sharedProps = {
    controls: true,
    preload: 'metadata' as const,
    src,
    onLoadedMetadata: handleLoadedMetadata,
    onTimeUpdate: handleTimeUpdate,
    onPause: handlePause,
    onEnded: handleEnded,
  }

  if (kind === 'video') {
    return (
      <video
        ref={setMediaRef}
        className="aspect-video w-full rounded-2xl bg-black"
        {...sharedProps}
      />
    )
  }

  return (
    <audio
      ref={setMediaRef}
      className="w-full"
      {...sharedProps}
    />
  )
}
