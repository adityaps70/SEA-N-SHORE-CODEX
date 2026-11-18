'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import {
  Captions,
  CaptionsOff,
  CircleHelp,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { refreshLessonMediaUrl } from '../learner-media-actions'
import { saveLearningPlaybackPosition } from '../learner-progress-actions'
import { announceLessonCompleted } from '../lesson-completion-events'
import { PLAYBACK_RATES, seekLimit } from '../media-watch-policy'
import { formatTimestamp, parseWebVtt, type CaptionCue } from '../webvtt'
import { useDataSaver } from '@/lib/browser/data-saver'
import { useHlsStream, type VideoStream } from './use-hls-stream'

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
  /** When the signed media URL expires (round E): the player fetches a fresh one shortly before. */
  expiresAt?: string | null
  /** Round E: a faint moving watermark over the video, e.g. "SNS-1A2B3C4D · 11 Oct 2026". Never a name or email. */
  watermark?: string | null
  /**
   * Round P3: the video's ready MediaConvert rendition (adaptive HLS, 360p and 720p). `src` is then its signed 720p
   * MP4, used where hls.js cannot play.
   */
  stream?: VideoStream | null
}

/**
 * Owner (17 Nov): a playback checkpoint every 60 seconds of playback (it was 15: about 5 Server Actions a minute per
 * viewer, half of all course-page requests), plus one on pause, end, seek, and when the tab is hidden or closed, so
 * the resume point is never more than a minute behind and nothing is lost on leaving.
 */
export const CHECKPOINT_SECONDS = 60
/** Fetch a fresh URL this long before the current one expires. */
const REFRESH_BEFORE_EXPIRY_MS = 3 * 60 * 1000
/** Offer "Resume from …" only for a saved position at least this far in and not at the very end. */
const RESUME_MIN_SECONDS = 5

function subscribeToNothing() {
  return () => {}
}

function pictureInPictureAvailable() {
  return 'pictureInPictureEnabled' in document && Boolean(document.pictureInPictureEnabled)
}

function showCaptions(media: HTMLMediaElement | null, on: boolean) {
  const track = media?.textTracks?.[0]
  if (track) track.mode = on ? 'showing' : 'hidden'
}

function wholeSeconds(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/** Keyboard shortcuts, shown in the "?" panel. */
export const PLAYER_SHORTCUTS: Array<[string, string]> = [
  ['Space or K', 'Play or pause'],
  ['J / L', 'Back or forward 10 seconds'],
  ['M', 'Mute or unmute'],
  ['F', 'Full screen'],
  ['C', 'Captions on or off'],
]

const controlButton = 'grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg text-white transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40'

export function ResumableLessonMedia({
  kind,
  src: initialSrc,
  slug,
  lessonId,
  initialPositionSeconds,
  initialFurthestSeconds = 0,
  initialWatchedSeconds = 0,
  completed = false,
  captionsSrc = null,
  expiresAt: initialExpiresAt = null,
  watermark = null,
  stream: initialStream = null,
}: ResumableLessonMediaProps) {
  const router = useRouter()
  const announcedRef = useRef(completed)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const lastPersistedPositionRef = useRef(wholeSeconds(initialPositionSeconds))
  const queuedPositionRef = useRef<{ position: number; duration?: number; watched?: number } | null>(null)
  const savingRef = useRef(false)
  // Real viewing: how far the learner reached and how much they actually played.
  const furthestRef = useRef(Math.max(wholeSeconds(initialFurthestSeconds), wholeSeconds(initialPositionSeconds)))
  const watchedRef = useRef(Math.max(0, initialWatchedSeconds))
  const lastTimeRef = useRef<number | null>(null)
  // After a URL refresh: where to continue and whether to keep playing.
  const restoreRef = useRef<{ time: number; play: boolean } | null>(null)
  const refreshingRef = useRef(false)
  const startedRef = useRef(false)
  // The source whose metadata was handled (see the catch-up effect below).
  const metadataSeenRef = useRef<string | null>(null)
  const [src, setSrc] = useState(initialSrc)
  const [stream, setStream] = useState<VideoStream | null>(kind === 'video' ? initialStream : null)
  const [mediaNode, setMediaNode] = useState<HTMLMediaElement | null>(null)
  const dataSaver = useDataSaver()
  const streamMode = useHlsStream(mediaNode, stream, dataSaver)
  const streamModeRef = useRef(streamMode)
  useEffect(() => {
    streamModeRef.current = streamMode
  }, [streamMode])
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt)
  const [rate, setRate] = useState(1)
  const [seekNotice, setSeekNotice] = useState(false)
  const pipSupported = useSyncExternalStore(subscribeToNothing, () => kind === 'video' && pictureInPictureAvailable(), () => false)
  const [cues, setCues] = useState<CaptionCue[] | null>(null)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [captionsOn, setCaptionsOn] = useState(Boolean(captionsSrc))
  const [fullscreen, setFullscreen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [resumeOffer, setResumeOffer] = useState<number | null>(null)
  // How far ahead the seek bar can go, shown on the bar (the ref is the source of truth for the seek cap).
  const [furthestShown, setFurthestShown] = useState(() => Math.floor(Math.max(initialFurthestSeconds, initialPositionSeconds)))
  const [mediaError, setMediaError] = useState<string | null>(null)
  const helpId = useId()

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
              setFurthestShown(Math.floor(furthestRef.current))
            }
            // The server just completed the lesson: unlock "Complete & next" and refresh the progress shown.
            if (result.completed && !announcedRef.current) {
              announcedRef.current = true
              announceLessonCompleted(lessonId)
              router.refresh()
            }
          }
        }
      } finally {
        savingRef.current = false
      }
    })()
  }, [lessonId, router, slug])

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
    setMediaNode(node)
  }, [])

  // Round E: swap in a fresh short-lived URL, keeping the learner's place (and playback, if it was playing).
  const refreshSource = useCallback(async () => {
    if (refreshingRef.current) return false
    refreshingRef.current = true
    try {
      const result = await refreshLessonMediaUrl(slug, lessonId)
      if (!result.ok) {
        setMediaError(result.error)
        return false
      }
      const media = mediaRef.current
      // HLS keeps playing: only the signed query changes. A file source reloads, so remember the place.
      if (media && streamModeRef.current !== 'hls') restoreRef.current = { time: media.currentTime, play: !media.paused && !media.ended }
      setMediaError(null)
      setSrc(result.url)
      setStream(kind === 'video' ? result.stream ?? null : null)
      setExpiresAt(result.expiresAt)
      return true
    } catch {
      setMediaError('We could not load this material. Please reload the page.')
      return false
    } finally {
      refreshingRef.current = false
    }
  }, [kind, lessonId, slug])

  useEffect(() => {
    if (!expiresAt) return
    const wait = Math.max(10_000, new Date(expiresAt).getTime() - Date.now() - REFRESH_BEFORE_EXPIRY_MS)
    const timer = window.setTimeout(() => void refreshSource(), wait)
    return () => window.clearTimeout(timer)
  }, [expiresAt, refreshSource])

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

  // Captions on or off: the track's mode follows the toggle (and a refreshed source keeps the choice).
  useEffect(() => {
    showCaptions(mediaRef.current, captionsOn)
  }, [captionsOn, src])

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(Boolean(document.fullscreenElement) && document.fullscreenElement === wrapperRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    metadataSeenRef.current = media.getAttribute('src')
    media.playbackRate = rate
    const mediaDuration = Number.isFinite(media.duration) ? media.duration : 0
    setDuration(mediaDuration)

    // After a URL refresh: continue exactly where the learner was.
    const restore = restoreRef.current
    if (restore) {
      restoreRef.current = null
      media.currentTime = restore.time
      lastTimeRef.current = media.currentTime
      if (restore.play) void media.play?.()?.catch?.(() => undefined)
      return
    }

    const persistedPosition = wholeSeconds(initialPositionSeconds)
    if (persistedPosition <= 0) return
    const position = mediaDuration > 0 ? Math.min(persistedPosition, mediaDuration) : persistedPosition
    if (kind === 'video' && !startedRef.current && position >= RESUME_MIN_SECONDS && (mediaDuration <= 0 || position < mediaDuration - RESUME_MIN_SECONDS)) {
      // Round E: offer to resume instead of jumping there unasked.
      setResumeOffer(position)
      return
    }
    media.currentTime = position
    lastTimeRef.current = media.currentTime
  }, [initialPositionSeconds, kind, rate])

  // The server-rendered element can load its metadata before React attaches onLoadedMetadata (the event is then
  // missed): catch up once after hydration, and after each source change, when the metadata is already there.
  useEffect(() => {
    const media = mediaRef.current
    if (!media || metadataSeenRef.current === src || media.readyState < 1) return
    metadataSeenRef.current = src
    handleLoadedMetadata()
  }, [handleLoadedMetadata, src])

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
    setFurthestShown(Math.floor(furthestRef.current))

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
    setCurrentTime(media.currentTime)
  }, [completed])

  // Owner (17 Nov): a seek is a deliberate new resume point, saved at once rather than at the next checkpoint.
  const handleSeeked = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    if (wholeSeconds(media.currentTime) === lastPersistedPositionRef.current) return
    queuePosition(media.currentTime, media.duration)
  }, [queuePosition])

  // Owner (17 Nov): leaving the tab (hidden, or the page closing) saves the resume point, since the next 60-second
  // checkpoint may never come. visibilitychange to hidden also fires when a tab or app is closed in modern browsers;
  // pagehide covers the rest. A position already saved is not sent again.
  useEffect(() => {
    function saveOnLeave() {
      const media = mediaRef.current
      if (!media) return
      if (wholeSeconds(media.currentTime) === lastPersistedPositionRef.current) return
      queuePosition(media.currentTime, media.duration)
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') saveOnLeave()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', saveOnLeave)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', saveOnLeave)
    }
  }, [queuePosition])

  const handlePause = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    setPlaying(false)
    queuePosition(media.currentTime, media.duration)
  }, [queuePosition])

  const handleEnded = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    setPlaying(false)
    queuePosition(media.duration || media.currentTime, media.duration)
  }, [queuePosition])

  const lastErrorRefreshRef = useRef(0)
  const handleError = useCallback(() => {
    // An expired or refused URL: fetch a fresh one and continue from the same place. At most once every 30 seconds,
    // so a file that cannot play never loops.
    const now = Date.now()
    if (now - lastErrorRefreshRef.current < 30_000) {
      setMediaError('This material could not be played. Please reload the page.')
      return
    }
    lastErrorRefreshRef.current = now
    void refreshSource()
  }, [refreshSource])

  function changeRate(next: number) {
    setRate(next)
    if (mediaRef.current) mediaRef.current.playbackRate = next
  }

  function togglePlay() {
    const media = mediaRef.current
    if (!media) return
    setResumeOffer(null)
    if (media.paused || media.ended) void media.play?.()?.catch?.(() => undefined)
    else media.pause()
  }

  function skip(seconds: number) {
    const media = mediaRef.current
    if (!media) return
    const target = Math.max(0, Math.min(media.currentTime + seconds, Number.isFinite(media.duration) ? media.duration : media.currentTime + seconds))
    media.currentTime = target
  }

  function toggleMute() {
    const media = mediaRef.current
    if (!media) return
    media.muted = !media.muted
    setMuted(media.muted)
  }

  function changeVolume(next: number) {
    const media = mediaRef.current
    if (!media) return
    media.volume = next
    media.muted = next === 0
    setVolume(next)
    setMuted(media.muted)
  }

  function toggleCaptions() {
    setCaptionsOn((on) => !on)
  }

  async function toggleFullscreen() {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await wrapper.requestFullscreen()
    } catch {
      // Full screen was refused (e.g. in an iframe); nothing to undo.
    }
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

  function resume(fromStart: boolean) {
    const media = mediaRef.current
    if (!media || resumeOffer === null) return
    media.currentTime = fromStart ? 0 : resumeOffer
    lastTimeRef.current = media.currentTime
    setResumeOffer(null)
    void media.play?.()?.catch?.(() => undefined)
  }

  function onPlayerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (target.tagName === 'SELECT' || (target.tagName === 'INPUT' && event.key.startsWith('Arrow'))) return
    const key = event.key.toLowerCase()
    if (key === ' ' || key === 'k') {
      if (target.tagName === 'BUTTON' && key === ' ') return
      event.preventDefault()
      togglePlay()
    } else if (key === 'j') {
      event.preventDefault()
      skip(-10)
    } else if (key === 'l') {
      event.preventDefault()
      skip(10)
    } else if (key === 'm') {
      event.preventDefault()
      toggleMute()
    } else if (key === 'f') {
      event.preventDefault()
      void toggleFullscreen()
    } else if (key === 'c' && captionsSrc) {
      event.preventDefault()
      toggleCaptions()
    } else if (key === '?') {
      event.preventDefault()
      setHelpOpen((open) => !open)
    }
  }

  // Round E: no download — no native menu, no context menu on the player.
  function blockContextMenu(event: MouseEvent) {
    event.preventDefault()
  }

  const activeCue = useMemo(
    () => cues?.findIndex((cue) => currentTime >= cue.start && currentTime < cue.end) ?? -1,
    [cues, currentTime],
  )

  const mediaHandlers = {
    preload: (dataSaver ? 'none' : 'metadata') as 'none' | 'metadata',
    // Round P3: no src attribute while hls.js may attach (it owns the element's source then).
    src: streamMode === 'file' ? src : undefined,
    onLoadedMetadata: handleLoadedMetadata,
    onTimeUpdate: handleTimeUpdate,
    onSeeking: handleSeeking,
    onSeeked: handleSeeked,
    onPause: handlePause,
    onEnded: handleEnded,
    onError: handleError,
    onContextMenu: blockContextMenu,
    controlsList: 'nodownload noremoteplayback',
  }

  const speedControl = (
    <label className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950">
      Speed
      <select
        value={rate}
        onChange={(event) => changeRate(Number(event.target.value))}
        className="cursor-pointer bg-transparent font-semibold text-navy-950"
      >
        {PLAYBACK_RATES.map((value) => <option key={value} value={value}>{value}×</option>)}
      </select>
    </label>
  )

  if (kind === 'audio') {
    return (
      <div onContextMenu={blockContextMenu}>
        <audio ref={setMediaRef} className="w-full" controls {...mediaHandlers} onPlay={() => setPlaying(true)} />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">{speedControl}</div>
        {seekNotice ? (
          <p role="status" className="mt-2 text-sm text-muted">You can skip ahead once you’ve listened up to here. Going back is always fine.</p>
        ) : null}
        {mediaError ? <p role="alert" className="mt-2 text-sm text-rose-800">{mediaError}</p> : null}
      </div>
    )
  }

  const reachable = completed ? duration : Math.min(duration, seekLimit(furthestShown))
  return (
    <div>
      <div
        ref={wrapperRef}
        role="group"
        aria-label="Video player"
        aria-describedby={helpId}
        tabIndex={0}
        onKeyDown={onPlayerKeyDown}
        onContextMenu={blockContextMenu}
        className="group/video relative overflow-hidden rounded-2xl bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
      >
        <video
          ref={setMediaRef}
          className={`w-full bg-black ${fullscreen ? 'h-full' : 'aspect-video'}`}
          playsInline
          disableRemotePlayback
          onClick={togglePlay}
          onPlay={() => { startedRef.current = true; setPlaying(true); setResumeOffer(null) }}
          {...mediaHandlers}
        >
          {captionsSrc ? <track kind="captions" src={captionsSrc} srcLang="en" label="Captions" default /> : null}
        </video>

        {watermark ? (
          // A faint moving mark (member code and date) deters screen recording; it never blocks the controls.
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <span className="lesson-video-watermark absolute select-none whitespace-nowrap text-xs font-semibold text-white/25 [text-shadow:0_1px_2px_rgb(0_0_0/0.4)]">
              {watermark}
            </span>
          </div>
        ) : null}

        {resumeOffer !== null ? (
          // Above the control bar, so the two never overlap on a phone.
          <div className="absolute inset-x-0 bottom-[4.5rem] top-0 grid place-items-center bg-navy-950/55 p-3">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" onClick={() => resume(false)} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50 max-sm:px-3">
                <Play aria-hidden="true" className="size-4" /> Resume from {formatTimestamp(resumeOffer)}
              </button>
              <button type="button" onClick={() => resume(true)} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/60 bg-navy-950/40 px-4 text-sm font-semibold text-white hover:bg-white/10 max-sm:px-3">
                <RotateCcw aria-hidden="true" className="size-4" /> Start over
              </button>
            </div>
          </div>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-3 pb-2 pt-8 text-white">
          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => jumpTo(Number(event.target.value))}
            aria-valuetext={`${formatTimestamp(currentTime)} of ${formatTimestamp(duration)}`}
            className="lesson-video-seek h-1.5 w-full cursor-pointer accent-teal-500"
            style={{ ['--reachable' as string]: duration ? `${(reachable / duration) * 100}%` : '0%' }}
          />
          <div className="mt-1 flex items-center gap-1">
            <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className={controlButton}>
              {playing ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5" />}
            </button>
            <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className={controlButton}>
              {muted || volume === 0 ? <VolumeX aria-hidden="true" className="size-5" /> : <Volume2 aria-hidden="true" className="size-5" />}
            </button>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => changeVolume(Number(event.target.value))}
              className="w-20 cursor-pointer accent-white max-sm:hidden"
            />
            <span className="ml-1 whitespace-nowrap font-mono text-xs tabular-nums text-white/90">
              {formatTimestamp(currentTime)} / {formatTimestamp(duration)}
            </span>
            <span className="flex-1" />
            {captionsSrc ? (
              <button type="button" onClick={toggleCaptions} aria-pressed={captionsOn} aria-label={captionsOn ? 'Turn captions off' : 'Turn captions on'} className={controlButton}>
                {captionsOn ? <Captions aria-hidden="true" className="size-5" /> : <CaptionsOff aria-hidden="true" className="size-5" />}
              </button>
            ) : null}
            {pipSupported ? (
              <button type="button" onClick={() => void togglePictureInPicture()} aria-label="Picture in picture" className={`${controlButton} max-sm:hidden`}>
                <PictureInPicture2 aria-hidden="true" className="size-5" />
              </button>
            ) : null}
            <button type="button" onClick={() => setHelpOpen((open) => !open)} aria-expanded={helpOpen} aria-label="Keyboard shortcuts" className={controlButton}>
              <CircleHelp aria-hidden="true" className="size-5" />
            </button>
            <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} className={controlButton}>
              {fullscreen ? <Minimize aria-hidden="true" className="size-5" /> : <Maximize aria-hidden="true" className="size-5" />}
            </button>
          </div>
        </div>

        <div id={helpId} hidden={!helpOpen} className="absolute right-3 top-3 max-w-[16rem] rounded-xl bg-navy-950/95 p-3 text-xs text-white shadow-lg">
          <p className="font-semibold">Keyboard shortcuts</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {PLAYER_SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="contents">
                <dt className="font-mono text-white/80">{keys}</dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {speedControl}
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
      {seekNotice ? (
        <p role="status" className="mt-2 text-sm text-muted">You can skip ahead once you’ve watched up to here. Going back is always fine.</p>
      ) : null}
      {mediaError ? <p role="alert" className="mt-2 text-sm text-rose-800">{mediaError}</p> : null}
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
