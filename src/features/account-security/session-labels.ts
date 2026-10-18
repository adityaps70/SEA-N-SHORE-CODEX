import { approximateLocation } from './request-context'
import type { ActiveSession } from './session-repository'
import { deviceKindOfSummary, type DeviceKind } from './user-agent'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function dayMonth(date: Date, now: Date, alwaysYear = false) {
  // India Standard Time (UTC+5:30, no daylight saving): the dates members see across the site.
  const ist = new Date(date.getTime() + 330 * MINUTE)
  const nowIst = new Date(now.getTime() + 330 * MINUTE)
  const label = `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}`
  return alwaysYear || ist.getUTCFullYear() !== nowIst.getUTCFullYear() ? `${label} ${ist.getUTCFullYear()}` : label
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

/** "Active now", "Active 12 minutes ago", … then "Active 1 Oct". */
export function lastActiveLabel(iso: string, now = Date.now()) {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return 'Last active unknown'
  const age = Math.max(0, now - at)
  if (age < 5 * MINUTE) return 'Active now'
  if (age < HOUR) return `Active ${plural(Math.floor(age / MINUTE), 'minute')} ago`
  if (age < DAY) return `Active ${plural(Math.floor(age / HOUR), 'hour')} ago`
  if (age < 7 * DAY) return `Active ${plural(Math.floor(age / DAY), 'day')} ago`
  return `Active ${dayMonth(new Date(at), new Date(now))}`
}

export function signedInLabel(iso: string, now = Date.now()) {
  const at = Date.parse(iso)
  return Number.isFinite(at) ? `Signed in ${dayMonth(new Date(at), new Date(now), true)}` : 'Signed in'
}

export function createdLabel(iso: string | null, now = Date.now()) {
  if (!iso) return null
  const at = Date.parse(iso)
  return Number.isFinite(at) ? dayMonth(new Date(at), new Date(now), true) : null
}

export type SessionView = {
  id: string
  device: string
  kind: DeviceKind
  location: string
  lastActive: string
  signedIn: string
  current: boolean
}

/** The rows of Settings › Account › Active sessions, this device first. */
export function sessionViews(sessions: ActiveSession[], currentSessionId: string | null, now = Date.now()): SessionView[] {
  return sessions
    .map((session) => ({
      id: session.id,
      device: session.userAgentSummary ?? (session.signInMethod === 'google' ? 'Google sign-in, unknown device' : 'Unknown device'),
      kind: deviceKindOfSummary(session.userAgentSummary),
      location: approximateLocation(session.approxCity, session.approxCountry) ?? 'Location unavailable',
      lastActive: session.id === currentSessionId ? 'Active now' : lastActiveLabel(session.lastSeenAt, now),
      signedIn: signedInLabel(session.createdAt, now),
      current: session.id === currentSessionId,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current))
}
