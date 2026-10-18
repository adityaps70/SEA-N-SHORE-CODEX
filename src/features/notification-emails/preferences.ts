import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import {
  NOTIFICATION_EMAIL_COLUMNS,
  NOTIFICATION_EMAIL_DEFAULTS,
  NOTIFICATION_EMAIL_KINDS,
  isNotificationEmailKind,
  type NotificationEmailKind,
} from './kinds'
import { notificationEmailTokenSecret, verifyNotificationEmailToken } from './tokens'

/**
 * Round H (H3): the four activity email switches in member_preferences (migration 0088). No row, or a NULL, means
 * on. Settings › Email notifications reads and writes them; the signed unsubscribe link turns one of them off.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export type NotificationEmailPreferences = Record<NotificationEmailKind, boolean>

export function createNotificationEmailPreferences(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function get(profileId: string): Promise<NotificationEmailPreferences> {
    const columns = NOTIFICATION_EMAIL_KINDS.map((kind) => NOTIFICATION_EMAIL_COLUMNS[kind]).join(', ')
    const rows = await queryRows(`select ${columns} from public.member_preferences where profile_id = $1`, [profileId])
    const row = rows[0]
    const result = { ...NOTIFICATION_EMAIL_DEFAULTS }
    for (const kind of NOTIFICATION_EMAIL_KINDS) {
      const value = row?.[NOTIFICATION_EMAIL_COLUMNS[kind]]
      if (typeof value === 'boolean') result[kind] = value
    }
    return result
  }

  /** Sets one switch. False when the member no longer exists (nothing is written). */
  async function set(profileId: string, kind: NotificationEmailKind, enabled: boolean) {
    if (!isNotificationEmailKind(kind) || typeof enabled !== 'boolean') throw new Error('notification_email_preference_invalid')
    const column = NOTIFICATION_EMAIL_COLUMNS[kind]
    const rows = await queryRows(
      `insert into public.member_preferences (profile_id, ${column}, updated_at)
       select profile.id, $2, now() from public.profiles profile where profile.id = $1
       on conflict (profile_id) do update set ${column} = excluded.${column}, updated_at = now()
       returning profile_id`,
      [profileId, enabled],
    )
    return rows.length > 0
  }

  return { get, set }
}

export type NotificationEmailUnsubscribeResult =
  | { ok: true; kind: NotificationEmailKind }
  | { ok: false; reason: 'invalid' | 'expired' | 'not_found' }

/** What a token would turn off, without changing anything (the confirmation page). */
export function inspectNotificationEmailToken(token: unknown, input: { secret?: string | null; now?: Date } = {}) {
  const secret = input.secret === undefined ? notificationEmailTokenSecret() : input.secret
  return verifyNotificationEmailToken(token, { secret, ...(input.now ? { now: input.now } : {}) })
}

/**
 * Turns off the one email type the signed token names, for the member it names. Idempotent: a second use says the
 * same. A forged or altered token changes nothing.
 */
export async function unsubscribeWithNotificationEmailToken(
  token: unknown,
  input: { secret?: string | null; now?: Date; preferences?: Pick<ReturnType<typeof createNotificationEmailPreferences>, 'set'> } = {},
): Promise<NotificationEmailUnsubscribeResult> {
  const verified = inspectNotificationEmailToken(token, input)
  if (!verified.ok) return verified
  const preferences = input.preferences ?? createNotificationEmailPreferences()
  const saved = await preferences.set(verified.profileId, verified.kind, false)
  return saved ? { ok: true, kind: verified.kind } : { ok: false, reason: 'not_found' }
}
