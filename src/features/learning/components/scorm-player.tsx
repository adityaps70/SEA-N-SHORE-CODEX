'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2, PlayCircle, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { commitLearningScormAttempt, startLearningScormAttempt } from '../scorm-actions'

type ScormApi = Record<string, (...args: string[]) => string>
type ScormWindow = Window & { API?: ScormApi; API_1484_11?: ScormApi }

type Props = {
  slug: string
  lessonId: string
  launchPath: string
  version: '1.2' | '2004'
  maxAttempts: number | null
  attemptsUsed: number
  initiallyCompleted: boolean
}

function contentUrl(lessonId: string, launchPath: string) {
  const encoded = launchPath.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return `/api/learning/scorm/${lessonId}/content/${encoded}`
}

export function ScormPlayer({
  slug,
  lessonId,
  launchPath,
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

  const attemptsRemaining = maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed)
  const canStart = maxAttempts === null || attemptsUsed < maxAttempts || initiallyCompleted
  const frameUrl = useMemo(() => contentUrl(lessonId, launchPath), [launchPath, lessonId])

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
    const target = window as ScormWindow
    const getValue = (key: string) => valuesRef.current[key] ?? ''
    const setValue = (key: string, value: string) => {
      valuesRef.current[key] = value
      lastErrorRef.current = '0'
      return 'true'
    }
    const finish = () => commit()

    // SCORM 1.2 discovers window.API; SCORM 2004 discovers window.API_1484_11.
    const API: ScormApi = {
      LMSInitialize: () => 'true',
      LMSFinish: finish,
      LMSGetValue: getValue,
      LMSSetValue: setValue,
      LMSCommit: commit,
      LMSGetLastError: () => lastErrorRef.current,
      LMSGetErrorString: () => '',
      LMSGetDiagnostic: () => '',
    }
    const API_1484_11: ScormApi = {
      Initialize: () => 'true',
      Terminate: finish,
      GetValue: getValue,
      SetValue: setValue,
      Commit: commit,
      GetLastError: () => lastErrorRef.current,
      GetErrorString: () => '',
      GetDiagnostic: () => '',
    }

    target.API = API
    target.API_1484_11 = API_1484_11
    return () => {
      if (target.API === API) delete target.API
      if (target.API_1484_11 === API_1484_11) delete target.API_1484_11
    }
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

  if (!started) {
    return (
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
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <PlayCircle className="size-4" aria-hidden="true" />}
              {canStart ? 'Start SCORM material' : 'Attempt limit reached'}
            </button>
            {error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-mist-200 bg-mist-50 px-4 py-3 text-sm">
        <span className="font-semibold text-navy-950">SCORM {version}{attemptNumber ? ` · Attempt ${attemptNumber}` : ' · Review mode'}</span>
        {completed ? (
          <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700"><CheckCircle2 className="size-4" /> Complete</span>
        ) : (
          <button type="button" onClick={() => { commit(); router.refresh() }} className="inline-flex items-center gap-1.5 font-bold text-teal-700">
            <RefreshCw className="size-4" /> Save progress
          </button>
        )}
      </div>
      <iframe
        title="SCORM learning material"
        src={frameUrl}
        className="min-h-[640px] w-full rounded-2xl border border-mist-200 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        allow="fullscreen"
      />
      {error ? <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p> : null}
    </div>
  )
}
