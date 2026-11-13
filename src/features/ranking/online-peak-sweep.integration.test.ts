import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createOnlinePeakSweep, ONLINE_PEAK_SWEEP_MS } from './online-peak-sweep'

/**
 * Round CAP (finding 8) against the real schema (PGlite, every migration): the hourly peak counts distinct real members
 * with a device session seen in the last 5 minutes; revoked sessions, older sessions and load-test accounts never
 * count, and a later, lower count never lowers the hour's peak. Placeholder data only.
 */
let db: TestDatabase
let sequence = 0
const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function member(loadTest = false) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, role_key, profile_type, is_load_test)
     values (gen_random_uuid(), $1, $2, now(), 'second_officer', 'seafarer', $3) returning id`,
    [`Placeholder Sailor ${sequence}`, `placeholder-online-${sequence}`, loadTest],
  )
  return rows[0]!.id as string
}

async function session(profileId: string, minutesAgo: number, revoked = false) {
  sequence += 1
  await db.query(
    `insert into public.auth_sessions (profile_id, token_origin_hash, last_seen_at, revoked_at, revoke_reason)
     values ($1, $2, now() - make_interval(mins => $3::int), $4, $5)`,
    [profileId, sequence.toString(16).padStart(64, '0'), minutesAgo, revoked ? new Date() : null, revoked ? 'signed_out' : null],
  )
}

const peak = async () => {
  const rows = await db.query(
    `select metric, value from public.ranking_metrics_daily where metric like 'online.%'`,
  )
  return rows.map((row) => [row.metric, Number(row.value)])
}

describe('online peak sweep (Round CAP finding 8)', () => {
  it('counts distinct real members seen in the last 5 minutes and keeps the hour peak', async () => {
    const sweep = createOnlinePeakSweep({ query })
    expect(sweep.everyMs).toBe(ONLINE_PEAK_SWEEP_MS)
    expect(sweep.everyMs).toBe(60_000)

    const two = await member()
    await session(two, 1)
    await session(two, 2) // a second device: still one member
    const one = await member()
    await session(one, 3)
    const old = await member()
    await session(old, 12)
    const revoked = await member()
    await session(revoked, 1, true)
    const test = await member(true)
    await session(test, 1)

    await sweep.run()
    const hour = new Date().toISOString().slice(11, 13)
    expect(await peak()).toEqual([[`online.peak_utc_h${hour}`, 2]])

    // Fewer online later in the hour: the peak stays.
    await db.query(`update public.auth_sessions set last_seen_at = now() - interval '30 minutes' where profile_id = $1`, [one])
    await sweep.run()
    expect(await peak()).toEqual([[`online.peak_utc_h${hour}`, 2]])
  })
})
