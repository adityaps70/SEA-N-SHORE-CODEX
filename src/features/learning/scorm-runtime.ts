export type ScormCompletionStatus = 'unknown' | 'not attempted' | 'incomplete' | 'completed' | 'passed' | 'failed'
export type ScormSuccessStatus = 'unknown' | 'passed' | 'failed'

export type ScormRuntimeState = {
  completionStatus: ScormCompletionStatus
  successStatus: ScormSuccessStatus
  scoreRaw: number | null
  scoreScaled: number | null
  location: string | null
  suspendData: string | null
  sessionTimeSeconds: number
  exitValue: string | null
}

export function createScormRuntimeState(): ScormRuntimeState {
  return {
    completionStatus: 'unknown',
    successStatus: 'unknown',
    scoreRaw: null,
    scoreScaled: null,
    location: null,
    suspendData: null,
    sessionTimeSeconds: 0,
    exitValue: null,
  }
}

function finiteNumber(value: string | undefined) {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeCompletion(value: string | undefined): ScormCompletionStatus | null {
  switch (value?.trim().toLowerCase()) {
    case 'not attempted': return 'not attempted'
    case 'incomplete': return 'incomplete'
    case 'completed': return 'completed'
    case 'passed': return 'passed'
    case 'failed': return 'failed'
    case 'unknown': return 'unknown'
    default: return null
  }
}

function normalizeSuccess(value: string | undefined): ScormSuccessStatus | null {
  switch (value?.trim().toLowerCase()) {
    case 'passed': return 'passed'
    case 'failed': return 'failed'
    case 'unknown': return 'unknown'
    default: return null
  }
}

export function parseScormTimeToSeconds(value: string | null | undefined): number {
  if (!value) return 0
  const trimmed = value.trim()
  const hms = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(trimmed)
  if (hms) {
    return Math.floor(Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) + Number(`0.${hms[4] ?? '0'}`))
  }
  const iso = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(trimmed)
  if (!iso) return 0
  return Math.floor(
    Number(iso[1] ?? 0) * 86400
    + Number(iso[2] ?? 0) * 3600
    + Number(iso[3] ?? 0) * 60
    + Number(iso[4] ?? 0),
  )
}

export function normalizeScorm12Update(
  current: ScormRuntimeState,
  values: Record<string, string>,
): ScormRuntimeState {
  const lessonStatus = normalizeCompletion(values['cmi.core.lesson_status'])
  const success = lessonStatus === 'passed'
    ? 'passed'
    : lessonStatus === 'failed'
      ? 'failed'
      : current.successStatus
  return {
    ...current,
    completionStatus: lessonStatus ?? current.completionStatus,
    successStatus: success,
    scoreRaw: finiteNumber(values['cmi.core.score.raw']) ?? current.scoreRaw,
    location: values['cmi.core.lesson_location'] ?? current.location,
    suspendData: values['cmi.suspend_data'] ?? current.suspendData,
    sessionTimeSeconds: values['cmi.core.session_time']
      ? parseScormTimeToSeconds(values['cmi.core.session_time'])
      : current.sessionTimeSeconds,
    exitValue: values['cmi.core.exit'] ?? current.exitValue,
  }
}

export function normalizeScorm2004Update(
  current: ScormRuntimeState,
  values: Record<string, string>,
): ScormRuntimeState {
  return {
    ...current,
    completionStatus: normalizeCompletion(values['cmi.completion_status']) ?? current.completionStatus,
    successStatus: normalizeSuccess(values['cmi.success_status']) ?? current.successStatus,
    scoreRaw: finiteNumber(values['cmi.score.raw']) ?? current.scoreRaw,
    scoreScaled: finiteNumber(values['cmi.score.scaled']) ?? current.scoreScaled,
    location: values['cmi.location'] ?? current.location,
    suspendData: values['cmi.suspend_data'] ?? current.suspendData,
    sessionTimeSeconds: values['cmi.session_time']
      ? parseScormTimeToSeconds(values['cmi.session_time'])
      : current.sessionTimeSeconds,
    exitValue: values['cmi.exit'] ?? current.exitValue,
  }
}

export function isScormCompletionTerminal(state: ScormRuntimeState) {
  return state.completionStatus === 'completed'
    || state.completionStatus === 'passed'
    || state.completionStatus === 'failed'
}

export function isScormSuccess(state: ScormRuntimeState) {
  return state.successStatus === 'passed' || state.completionStatus === 'passed'
}
