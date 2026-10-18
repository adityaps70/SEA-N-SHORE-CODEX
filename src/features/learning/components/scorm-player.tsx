'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronRight, Clock, Loader2, Maximize2, Minimize2, Monitor, PlayCircle, Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'
import { announceLessonCompleted } from '../lesson-completion-events'
import { SCORM_BRIDGE_SOURCE, SCORM_HOST_SOURCE } from '../scorm-bridge'
import { commitLearningScormAttempt, startLearningScormAttempt } from '../scorm-actions'

type BridgeMessage = { source?: unknown; type?: unknown; key?: unknown; value?: unknown; values?: unknown }

/** S2: the compact one-line header above the package (the page keeps an sr-only h1 with the title). */
export type ScormLessonHeader = {
  /** "Module 2", or the trainer's numbered module title (moduleCrumb). */
  crumb: string | null
  title: string
  /** "4 min", or null when the trainer set no duration. */
  duration: string | null
}

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
  header?: ScormLessonHeader | null
}

/** S2: the frame never gets shorter than this; below it the page scrolls rather than squeezing the package. */
export const SCORM_FRAME_MIN_HEIGHT = 520
/** "Saved" stays on screen this long after a commit. */
const SAVED_VISIBLE_MS = 2500

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

/**
 * S2: everything on the page around the frame, in px: its top edge (document coordinates) plus whatever follows
 * it to the end of the page content (the lesson bar and the paddings). The frame's height is then
 * `100dvh - chrome`, so the header, the frame and the lesson bar fill the window exactly. The page's <main>
 * ends where its content ends (the shell's min-height sits outside it), so a short page cannot inflate it.
 */
function measureChrome(frame: HTMLElement) {
  if (!frame.getClientRects().length) return null // in a hidden tab panel
  const box = frame.getBoundingClientRect()
  const end = frame.closest('main') ?? frame.parentElement
  const below = end ? Math.max(0, end.getBoundingClientRect().bottom - box.bottom) : 0
  return Math.ceil(box.top + window.scrollY + below)
}

/** Focus mode: everything outside the stage is inert, so Tab and screen readers stay inside it. */
function inertOutside(element: HTMLElement) {
  const changed: Element[] = []
  let node: Element = element
  while (node.parentElement && node !== document.body) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.hasAttribute('inert') || sibling.tagName === 'SCRIPT') continue
      sibling.setAttribute('inert', '')
      changed.push(sibling)
    }
    node = node.parentElement
  }
  return () => changed.forEach((sibling) => sibling.removeAttribute('inert'))
}

/** A small tooltip under a header button, on hover and on keyboard focus (the button carries its own name). */
function Tooltip({ id, children }: { id: string; children: string }) {
  return (
    <span
      id={id}
      role="tooltip"
      className="pointer-events-none absolute right-0 top-full z-10 mt-1.5 w-max max-w-56 rounded-lg bg-navy-950 px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity peer-hover:opacity-100 peer-focus-visible:opacity-100"
    >
      {children}
    </span>
  )
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
  header = null,
}: Props) {
  const router = useRouter()
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [started, setStarted] = useState(initiallyCompleted)
  const [pending, setPending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [completed, setCompleted] = useState(initiallyCompleted)
  const [focusMode, setFocusMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valuesRef = useRef<Record<string, string>>({})
  const lastErrorRef = useRef('0')
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const focusButtonRef = useRef<HTMLButtonElement | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasFocusModeRef = useRef(false)
  const tooltipId = useId()

  const attemptsRemaining = maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed)
  const canStart = maxAttempts === null || attemptsUsed < maxAttempts || initiallyCompleted
  const frameUrl = useMemo(() => contentUrl(lessonId, launchPath, contentToken), [contentToken, launchPath, lessonId])

  /** Saves the runtime values (autosave on the package's commit/finish, or the Save button). True when saved. */
  const commit = useCallback(async () => {
    if (!attemptId) return true
    const values = { ...valuesRef.current }
    const result = await commitLearningScormAttempt(slug, attemptId, values)
    if (!result.ok) {
      setError(result.error)
      lastErrorRef.current = '101'
      return false
    }
    lastErrorRef.current = '0'
    setError(null)
    setSaved(true)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaved(false), SAVED_VISIBLE_MS)
    // Completion is decided on the server from cmi.core.lesson_status / cmi.completion_status. A completing
    // commit revalidates the lesson page; the bar's "Complete & next" also unlocks at once.
    if (result.completed) {
      setCompleted(true)
      announceLessonCompleted(lessonId)
    }
    return true
  }, [attemptId, lessonId, slug])

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
  }, [])

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
      // S2: Esc pressed inside the package (the bridge forwards it) leaves focus mode.
      if (data.type === 'escape') {
        setFocusMode(false)
        return
      }
      if (data.type === 'commit' || data.type === 'finish') {
        if (data.values && typeof data.values === 'object') {
          for (const [key, value] of Object.entries(data.values as Record<string, unknown>)) {
            if (typeof value === 'string') valuesRef.current[key] = value
          }
        }
        void commit()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [commit, started])

  // S2: the frame fills the window under the page's header, down to the lesson bar (minimum 520px).
  useEffect(() => {
    const frame = frameRef.current
    if (!started || focusMode || !frame) return
    const fit = () => {
      const chrome = measureChrome(frame)
      if (chrome === null) return
      const value = `${chrome}px`
      if (frame.style.getPropertyValue('--scorm-chrome') !== value) frame.style.setProperty('--scorm-chrome', value)
    }
    fit()
    window.addEventListener('resize', fit)
    // Banners, a wrapping toolbar or the sidebar collapsing move the frame: measure again.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    const end = frame.closest('main') ?? frame.parentElement
    if (observer && end) observer.observe(end)
    return () => {
      window.removeEventListener('resize', fit)
      observer?.disconnect()
    }
  }, [focusMode, started])

  // S2 focus mode: the same frame, positioned over the whole window (never re-mounted, so the SCORM runtime
  // stays attached). Esc leaves; the page behind is inert and does not scroll.
  useEffect(() => {
    const stage = stageRef.current
    if (!focusMode || !stage) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) setFocusMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.overflow = 'hidden'
    const restoreInert = inertOutside(stage)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      root.style.overflow = previousOverflow
      restoreInert()
    }
  }, [focusMode])

  // Leaving focus mode (the button, or Esc on the page or in the package) puts focus back on its button.
  useEffect(() => {
    if (wasFocusModeRef.current && !focusMode) focusButtonRef.current?.focus()
    wasFocusModeRef.current = focusMode
  }, [focusMode])

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
      setStarted(true)
    } finally {
      setPending(false)
    }
  }

  async function saveNow() {
    if (saving) return
    setSaving(true)
    try {
      if (await commit()) router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const headerRow = (
    <div data-scorm-header="" className="flex min-h-12 items-center gap-2 border-b border-mist-100 bg-white px-3 py-1 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {header ? (
          <>
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
                {header.crumb ? (
                  <>
                    <li className="min-w-0 max-w-[40%] shrink-0 truncate max-sm:sr-only">{header.crumb}</li>
                    <li aria-hidden="true" className="max-sm:hidden"><ChevronRight className="size-3.5" /></li>
                  </>
                ) : null}
                <li className="min-w-0 truncate font-semibold text-navy-900" aria-current="page">{header.title}</li>
              </ol>
            </nav>
            {header.duration ? (
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-meta text-muted">
                <Clock aria-hidden="true" className="size-3.5" />{header.duration}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      {started ? (
        <>
          <p role="status" aria-live="polite" className="shrink-0 text-meta font-semibold text-emerald-700">
            {saved ? 'Saved' : ''}
          </p>
          {completed ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-meta font-bold text-emerald-700">
              <CheckCircle2 aria-hidden="true" className="size-4" /> <span className="max-sm:sr-only">Complete</span>
            </span>
          ) : (
            <span className="relative inline-flex shrink-0">
              <button
                type="button"
                aria-label="Save progress"
                aria-describedby={`${tooltipId}-save`}
                disabled={saving}
                onClick={() => void saveNow()}
                className={cn(buttonClass({ variant: 'quiet', size: 'sm' }), 'peer size-10 px-0 text-teal-700')}
              >
                {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
              </button>
              <Tooltip id={`${tooltipId}-save`}>Save progress (it also saves automatically)</Tooltip>
            </span>
          )}
          <span className="relative inline-flex shrink-0">
            <button
              ref={focusButtonRef}
              type="button"
              aria-pressed={focusMode}
              aria-describedby={`${tooltipId}-focus`}
              onClick={() => setFocusMode((value) => !value)}
              className={cn(buttonClass({ variant: 'quiet', size: 'sm' }), 'peer px-3 max-sm:size-10 max-sm:px-0')}
            >
              {focusMode ? <Minimize2 aria-hidden="true" className="size-4" /> : <Maximize2 aria-hidden="true" className="size-4" />}
              <span className="max-sm:sr-only">{focusMode ? 'Exit focus mode' : 'Focus mode'}</span>
            </button>
            <Tooltip id={`${tooltipId}-focus`}>{focusMode ? 'Back to the lesson page (Esc)' : 'Fill the window with the module. Esc to leave.'}</Tooltip>
          </span>
        </>
      ) : null}
    </div>
  )

  if (!started) {
    return (
      <div data-scorm-stage="">
        {headerRow}
        <div className="space-y-3 p-4 sm:p-6">
          <div role="note" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 md:hidden">
            <Monitor aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
            <p>Interactive SCORM material works best on a computer. You can still take it here; Focus mode gives it the whole screen.</p>
          </div>
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
      </div>
    )
  }

  return (
    <div
      ref={stageRef}
      data-scorm-stage=""
      data-focus-mode={focusMode ? 'on' : 'off'}
      className={cn('bg-white', focusMode && 'fixed inset-0 z-[100] flex flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]')}
    >
      {headerRow}
      {error ? <p role="alert" className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}
      <iframe
        ref={frameRef}
        title="SCORM learning material"
        src={frameUrl}
        data-scorm-frame=""
        // Fills the window under the page chrome (measured into --scorm-chrome); in focus mode, the window under the header.
        style={focusMode ? undefined : { height: `max(${SCORM_FRAME_MIN_HEIGHT}px, calc(100dvh - var(--scorm-chrome, 16.5rem)))` }}
        className={cn('block w-full border-0 bg-white', focusMode && 'min-h-0 flex-1')}
        sandbox="allow-scripts allow-forms allow-popups allow-downloads"
        allow="fullscreen"
      />
    </div>
  )
}
