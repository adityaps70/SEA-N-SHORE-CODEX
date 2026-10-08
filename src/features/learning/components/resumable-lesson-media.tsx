'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Captions, PictureInPicture2 } from 'lucide-react'
import { saveLearningPlaybackPosition } from '../learner-progress-actions'
import { PLAYBACK_RATES, seekLimit } from '../media-watch-policy'
import { formatTimestamp, parseWebVtt, type CaptionCue } from '../webvtt'

type ResumableLessonMediaProps = {
  kind: 'video' | 'audio'
  src: string
  slug: string
  lessonId: string
  initialPositionSeconds: number
  /** How far the learner has reached; forward seeking stops a few seconds past it (A7). */
  initialFurthestSeconds?: number
  /** Playback time counted so far, across sessions. */
  initialWatchedSeconds?: number
  /** Completed media can be watched in any order. */
  completed?: boolean
  /** Same-origin WebVTT captions (/api/learn/captions/<lesson id>), videos only. */
  captionsSrc?: string | null
}

const CHECKPOINT_SECONDS = 15

function subscribeToNothing() {
  return () => {}
}

function pictureInPictureAvailable() {
  return 'pictureInPictureEnabled' in document && Boolean(document.pictureInPictureEnabled)
}

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
  initialFurthestSeconds = 0,
  initialWatchedSeconds = 0,
  completed = false,
  captionsSrc = null,
}: ResumableLessonMediaProps) {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const lastPersistedPositionRef = useRef(wholeSeconds(initialPositionSeconds))
  const queuedPositionRef = useRef<{ position: number; duration?: number; watched?: number } | null>(null)
  const savingRef = useRef(false)
  // Real viewing: how far the learner reached and how much they actually played.
  const furthestRef = useRef(Math.max(wholeSeconds(initialFurthestSeconds), wholeSeconds(initialPositionSeconds)))
  const watchedRef = useRef(Math.max(0, initialWatchedSeconds))
  const lastTimeRef = useRef<number | null>(null)
  const [rate, setRate] = useState(1)
  const [seekNotice, setSeekNotice] = useState(false)
  const pipSupported = useSyncExternalStore(subscribeToNothing, () => kind === 'video' && pictureInPictureAvailable(), () => false)
  const [cues, setCues] = useState<CaptionCue[] | null>(null)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)

  const flushQueuedPosition = useCallback(() => {
    if (savingRef.current) return
    savingRef.current = true

    void (async () => {
      try {
        while (queuedPositionRef.current !== null) {
          const next = queuedPositionRef.current
          queuedPositionRef.current = null

          if (next.position === lastPersistedPositionRef.current && next.watched === undefined) continue

          const result = next.duration === undefined
            ? await saveLearningPlaybackPosition(slug, lessonId, next.position)
            : await saveLearningPlaybackPosition(slug, lessonId, next.position, next.duration, next.watched)
          if (result.ok) {
            lastPersistedPositionRef.current = wholeSeconds(result.lastPositionSeconds)
            if (typeof result.furthestPositionSeconds === 'number') {
              furthestRef.current = Math.max(furthestRef.current, result.furthestPositionSeconds)
            }
          }
        }
      } finally {
        savingRef.current = false
      }
    })()
  }, [lessonId, slug])

  const queuePosition = useCallback((positionSeconds: number, durationSeconds?: number) => {
    const normalizedPosition = wholeSeconds(positionSeconds)
    const knownDuration = durationSeconds && Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined
    if (normalizedPosition === lastPersistedPositionRef.current && queuedPositionRef.current === null && knownDuration === undefined) return

    queuedPositionRef.current = {
      position: normalizedPosition,
      duration: knownDuration,
      watched: knownDuration === undefined ? undefined : wholeSeconds(watchedRef.current),
    }
    flushQueuedPosition()
  }, [flushQueuedPosition])

  const setMediaRef = useCallback((node: HTMLMediaElement | null) => {
    mediaRef.current = node
  }, [])


  useEffect(() => {
    if (!captionsSrc || !transcriptOpen || cues !== null) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(captionsSrc, { credentials: 'same-origin' })
        const text = response.ok ? await response.text() : ''
        if (!cancelled) setCues(parseWebVtt(text))
      } catch {
        if (!cancelled) setCues([])
      }
    })()
    return () => { cancelled = true }
  }, [captionsSrc, cues, transcriptOpen])

  const handleLoadedMetadata = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    media.playbackRate = rate

    const persistedPosition = wholeSeconds(initialPositionSeconds)
    if (persistedPosition <= 0) return

    const duration = media.duration
    media.currentTime = Number.isFinite(duration) && duration >= 0
      ? Math.min(persistedPosition, duration)
      : persistedPosition
    lastTimeRef.current = media.currentTime
  }, [initialPositionSeconds, rate])

  const handleTimeUpdate = useCallback(() => {
    const media = mediaRef.current
    if (!media) return

    // Count real playback only: small forward steps while playing, not jumps.
    const previous = lastTimeRef.current
    const now = media.currentTime
    if (previous !== null && !media.seeking) {
      const step = now - previous
      if (step > 0 && step <= 1.5 * Math.max(media.playbackRate || 1, 1) + 0.5) {
        watchedRef.current += step
        if (now > furthestRef.current && now <= seekLimit(furthestRef.current)) furthestRef.current = now
      }
    }
    lastTimeRef.current = now
    setCurrentTime(now)

    const currentPosition = wholeSeconds(now)
    if (Math.abs(currentPosition - lastPersistedPositionRef.current) < CHECKPOINT_SECONDS) return
    queuePosition(currentPosition, media.duration)
  }, [queuePosition])

  const handleSeeking = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    if (!completed && media.currentTime > seekLimit(furthestRef.current)) {
      // Seeking back is always fine; ahead only as far as the learner has watched.
      media.currentTime = furthestRef.current
      setSeekNotice(true)
    } else {
      setSeekNotice(false)
    }
    lastTimeRef.current = media.currentTime
  }, [completed])

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

  function changeRate(next: number) {
    setRate(next)
    if (mediaRef.current) mediaRef.current.playbackRate = next
  }

  async function togglePictureInPicture() {
    const media = mediaRef.current
    if (!(media instanceof HTMLVideoElement)) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await media.requestPictureInPicture()
    } catch {
      // The browser declined (for example before playback starts); nothing to undo.
    }
  }

  function jumpTo(seconds: number) {
    const media = mediaRef.current
    if (!media) return
    media.currentTime = seconds
  }

  const activeCue = useMemo(
    () => cues?.findIndex((cue) => currentTime >= cue.start && currentTime < cue.end) ?? -1,
    [cues, currentTime],
  )

  const sharedProps = {
    controls: true,
    preload: 'metadata' as const,
    src,
    onLoadedMetadata: handleLoadedMetadata,
    onTimeUpdate: handleTimeUpdate,
    onSeeking: handleSeeking,
    onPause: handlePause,
    onEnded: handleEnded,
  }

  const controls = (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <label className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 font-semibold text-navy-950">
        Speed
        <select
          value={rate}
          onChange={(event) => changeRate(Number(event.target.value))}
          className="cursor-pointer bg-transparent font-semibold text-navy-950 outline-none"
        >
          {PLAYBACK_RATES.map((value) => <option key={value} value={value}>{value}×</option>)}
        </select>
      </label>
      {pipSupported ? (
        <button type="button" onClick={() => void togglePictureInPicture()} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 font-semibold text-navy-950 hover:bg-mist-50">
          <PictureInPicture2 aria-hidden="true" className="size-4" /> Picture in picture
        </button>
      ) : null}
      {captionsSrc ? (
        <button
          type="button"
          aria-expanded={transcriptOpen}
          onClick={() => setTranscriptOpen((open) => !open)}
          className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 font-semibold text-navy-950 hover:bg-mist-50"
        >
          <Captions aria-hidden="true" className="size-4" /> {transcriptOpen ? 'Hide transcript' : 'Transcript'}
        </button>
      ) : null}
    </div>
  )

  if (kind === 'video') {
    return (
      <div>
        <video
          ref={setMediaRef}
          className="aspect-video w-full rounded-2xl bg-black"
          {...sharedProps}
        >
          {captionsSrc ? <track kind="captions" src={captionsSrc} srcLang="en" label="Captions" default /> : null}
        </video>
        {controls}
        {seekNotice ? (
          <p role="status" className="mt-2 text-sm text-muted">You can skip ahead once you’ve watched up to here. Going back is always fine.</p>
        ) : null}
        {captionsSrc && transcriptOpen ? (
          <section aria-label="Transcript" className="mt-3 max-h-80 overflow-y-auto rounded-2xl border border-mist-200 bg-white p-2">
            {cues === null ? (
              <p className="p-2 text-sm text-muted">Loading the transcript…</p>
            ) : cues.length === 0 ? (
              <p className="p-2 text-sm text-muted">The transcript isn’t available for this video.</p>
            ) : (
              <ol className="space-y-0.5">
                {cues.map((cue, index) => (
                  <li key={`${cue.start}-${index}`}>
                    <button
                      type="button"
                      onClick={() => jumpTo(cue.start)}
                      aria-current={index === activeCue ? 'true' : undefined}
                      className={`flex w-full cursor-pointer gap-3 rounded-lg px-2 py-1.5 text-left text-sm leading-6 transition ${index === activeCue ? 'bg-teal-50 text-navy-950' : 'text-navy-900 hover:bg-mist-50'}`}
                    >
                      <span className="w-14 shrink-0 font-mono text-xs leading-6 text-muted">{formatTimestamp(cue.start)}</span>
                      <span>{cue.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      <audio
        ref={setMediaRef}
        className="w-full"
        {...sharedProps}
      />
      {controls}
      {seekNotice ? (
        <p role="status" className="mt-2 text-sm text-muted">You can skip ahead once you’ve listened up to here. Going back is always fine.</p>
      ) : null}
    </div>
  )
}
