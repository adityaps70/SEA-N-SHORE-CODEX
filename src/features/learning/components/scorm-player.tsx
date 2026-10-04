'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Expand, Loader2, Monitor, PlayCircle, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { SCORM_BRIDGE_SOURCE, SCORM_HOST_SOURCE } from '../scorm-bridge'
import { commitLearningScormAttempt, startLearningScormAttempt } from '../scorm-actions'

type BridgeMessage = { source?: unknown; type?: unknown; key?: unknown; value?: unknown; values?: unknown }

type Props = {
  slug: string
  lessonId: string
  launchPath: string
  /** Signed path segment for the sandboxed package's own requests (Round 14, 2.3). */
  contentToken?: string | null
  version: '1.2' | '2004'
  maxAttempts: number | null
  attemptsUsed: number
  initiallyCompleted: boolean
}

function contentUrl(lessonId: string, launchPath: string, contentToken: string | null) {
  const encoded = launchPath.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  const prefix = contentToken ? `${encodeURIComponent(contentToken)}/` : ''
  return `/api/learning/scorm/${lessonId}/content/${prefix}${encoded}`
}

/** True when a message comes from the SCORM frame or a frame nested inside it. */
function isFromFrame(source: MessageEventSource | null, frame: HTMLIFrameElement | null) {
  const frameWindow = frame?.contentWindow
  let current = source as Window | null
  for (let depth = 0; current && frameWindow && depth < 8; depth += 1) {
    if (current === frameWindow) return true
    if (current.parent === current) return false
    current = current.parent
  }
  return false
}

export function ScormPlayer({
  slug,
  lessonId,
  launchPath,
  contentToken = null,
  version,
  maxAttempts,
  attemptsUsed,
  initiallyCompleted,
}: Props) {
  const router = useRouter()
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [attemptNumber, setAttemptNumber] = useState<number | null>(null)
  const [started, setStarted] = useState(initiallyCompleted)
  const [pending, setPending] = useState(false)
  const [completed, setCompleted] = useState(initiallyCompleted)
  const [error, setError] = useState<string | null>(null)
  const valuesRef = useRef<Record<string, string>>({})
  const lastErrorRef = useRef('0')
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  const attemptsRemaining = maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed)
  const canStart = maxAttempts === null || attemptsUsed < maxAttempts || initiallyCompleted
  const frameUrl = useMemo(() => contentUrl(lessonId, launchPath, contentToken), [contentToken, launchPath, lessonId])

  const commit = useCallback(() => {
    if (!attemptId) return 'true'
    const values = { ...valuesRef.current }
    void (async () => {
      const result = await commitLearningScormAttempt(slug, attemptId, values)
      if (!result.ok) {
        setError(result.error)
        lastErrorRef.current = '101'
        return
      }
      lastErrorRef.current = '0'
      if (result.completed) {
        setCompleted(true)
        router.refresh()
      }
    })()
    return 'true'
  }, [attemptId, router, slug])

  useEffect(() => {
    if (!started) return
    // The package runs sandboxed in its own origin (Round 14, 2.3). The bridge injected into its
    // pages keeps the synchronous SCORM 1.2 window.API / SCORM 2004 window.API_1484_11 inside the
    // frame and mirrors every value here, where commits are saved exactly as before.
    function onMessage(event: MessageEvent) {
      const data = event.data as BridgeMessage | null
      if (!data || data.source !== SCORM_BRIDGE_SOURCE || !isFromFrame(event.source, frameRef.current)) return
      if (data.type === 'hello') {
        ;(event.source as Window).postMessage({ source: SCORM_HOST_SOURCE, type: 'init', values: { ...valuesRef.current } }, '*')
        return
      }
      if (data.type === 'set' && typeof data.key === 'string' && typeof data.value === 'string') {
        valuesRef.current[data.key] = data.value
        lastErrorRef.current = '0'
        return
      }
      if (data.type === 'commit' || data.type === 'finish') {
        if (data.values && typeof data.values === 'object') {
          for (const [key, value] of Object.entries(data.values as Record<string, unknown>)) {
            if (typeof value === 'string') valuesRef.current[key] = value
          }
        }
        commit()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [commit, started])

  async function startAttempt() {
    if (pending || !canStart) return
    setPending(true)
    setError(null)
    try {
      const result = await startLearningScormAttempt(slug, lessonId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      valuesRef.current = version === '1.2'
        ? { 'cmi.core.lesson_status': 'not attempted' }
        : { 'cmi.completion_status': 'not attempted', 'cmi.success_status': 'unknown' }
      setAttemptId(result.attemptId)
      setAttemptNumber(result.attemptNumber)
      setStarted(true)
    } finally {
      setPending(false)
    }
  }

  // Full screen keeps the SCORM runtime bridge attached, unlike opening the package in a new tab.
  function openFullScreen() {
    const frame = frameRef.current
    if (frame?.requestFullscreen) void frame.requestFullscreen().catch(() => undefined)
  }

  const phoneNotice = (
    <div role="note" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 md:hidden">
      <Monitor aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
      <p>Interactive SCORM material works best on a computer. You can still take it here{started ? ' — open it full screen for more room.' : '.'}</p>
    </div>
  )

  if (!started) {
    return (
      <div className="space-y-3">
      {phoneNotice}
      <div className="rounded-2xl border border-mist-200 bg-mist-50 p-5">
        <div className="flex items-start gap-3">
          <PlayCircle className="mt-0.5 size-5 text-teal-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-navy-950">SCORM {version} interactive material</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              Your progress, completion status and SCORM runtime data are saved to Sea N Shore.
            </p>
            {attemptsRemaining !== null ? (
              <p className="mt-2 text-xs font-semibold text-muted">{attemptsRemaining} attempt{attemptsRemaining === 1 ? '' : 's'} remaining</p>
            ) : null}
            <button
              type="button"
              disabled={pending || !canStart}
              onClick={() => void startAttempt()}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 enabled:hover:bg-navy-800 transition-colors disabled:cursor-not-allowed"
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <PlayCircle className="size-4" aria-hidden="true" />}
              {canStart ? 'Start SCORM material' : 'Attempt limit reached'}
            </button>
            {error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
          </div>
        </div>
      </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {phoneNotice}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-mist-200 bg-mist-50 px-4 py-3 text-sm">
        <span className="font-semibold text-navy-950">SCORM {version}{attemptNumber ? ` · Attempt ${attemptNumber}` : ' · Review mode'}</span>
        {completed ? (
          <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700"><CheckCircle2 className="size-4" /> Complete</span>
        ) : (
          <button type="button" onClick={() => { commit(); router.refresh() }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-3 font-bold text-teal-700 transition-colors hover:border-teal-300 hover:bg-teal-50">
            <RefreshCw className="size-4" /> Save progress
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={openFullScreen}
        className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-ocean-700 bg-white px-4 text-[15px] font-semibold text-ocean-700 hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 md:hidden"
      >
        <Expand aria-hidden="true" className="size-5" /> Open full screen
      </button>
      <iframe
        ref={frameRef}
        title="SCORM learning material"
        src={frameUrl}
        className="min-h-[640px] w-full rounded-2xl border border-mist-200 bg-white max-md:min-h-[70dvh]"
        sandbox="allow-scripts allow-forms allow-popups allow-downloads"
        allow="fullscreen"
      />
      {error ? <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p> : null}
    </div>
  )
}
