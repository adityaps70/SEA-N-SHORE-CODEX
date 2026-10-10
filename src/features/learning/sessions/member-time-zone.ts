import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { DEFAULT_TIME_ZONE, isValidTimeZone } from './session-time'

/**
 * Learning round D (D2): the member's time zone for session emails (profiles.time_zone, time_zone_source). Pages
 * always show times in the device's own zone; emails use this one. "Automatic" follows the device the member last
 * used; "manual" keeps the zone they chose (a seafarer can pin home time while at sea).
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export type MemberTimeZone = { timeZone: string | null; source: 'auto' | 'manual' }

export function createMemberTimeZoneRepository(input: { query?: Query } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function get(profileId: string): Promise<MemberTimeZone> {
    const rows = await query(`select time_zone, time_zone_source from public.profiles where id = $1::uuid`, [profileId])
    const row = rows[0]
    return {
      timeZone: row?.time_zone && isValidTimeZone(row.time_zone) ? String(row.time_zone) : null,
      source: row?.time_zone_source === 'manual' ? 'manual' : 'auto',
    }
  }

  /** "Automatic" (the zone given is the device's, may be null) or "manual" (a chosen zone). */
  async function save(profileId: string, choice: { source: 'auto' | 'manual'; timeZone: string | null }) {
    if (choice.source === 'manual' && !isValidTimeZone(choice.timeZone)) throw new Error('time_zone_invalid')
    const zone = choice.timeZone && isValidTimeZone(choice.timeZone) ? choice.timeZone : null
    await query(
      `update public.profiles set time_zone = coalesce($2, time_zone), time_zone_source = $3, updated_at = now() where id = $1::uuid`,
      [profileId, zone, choice.source],
    )
  }

  /** Stores the device's zone when the member is on "Automatic" and it changed. Returns whether it was stored. */
  async function syncDevice(profileId: string, deviceZone: string) {
    if (!isValidTimeZone(deviceZone)) return false
    const rows = await query(
      `update public.profiles set time_zone = $2, updated_at = now()
       where id = $1::uuid and time_zone_source = 'auto' and time_zone is distinct from $2
       returning id`,
      [profileId, deviceZone],
    )
    return rows.length > 0
  }

  return { get, save, syncDevice }
}

export const memberTimeZoneRepository = createMemberTimeZoneRepository()

export function emailTimeZone(zone: string | null | undefined) {
  return zone && isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE
}
