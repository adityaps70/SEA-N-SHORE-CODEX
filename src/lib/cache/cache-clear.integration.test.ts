import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { CACHE_CLEAR_CHANNEL } from './cache-clear'

/**
 * Owner (18 Nov) against the real schema (PGlite, every migration): migration 0111's triggers send one clear per
 * change to cached data, only when the change commits, with ids only, and never for the last-seen touch.
 */

let db: TestDatabase
const received: string[] = []
let alice = ''
let bob = ''
let carol = ''

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeAll(async () => {
  db = await createTestDatabase()
  await db.listen(CACHE_CLEAR_CHANNEL, (payload) => { received.push(payload) })
  const rows = await db.query(
    `insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Member A'), (gen_random_uuid(), 'Placeholder Member B'), (gen_random_uuid(), 'Placeholder Member C') returning id`,
  )
  ;[alice, bob, carol] = rows.map((row) => String(row.id))
}, 120_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await settle()
  received.length = 0
})

describe('cache clear triggers (migration 0111)', () => {
  it('sends p:<id> when a profile, its maritime profile or its skills change', async () => {
    await db.query(`update public.profiles set full_name = 'Placeholder Member A2' where id = $1`, [alice])
    await db.query(`insert into public.maritime_profiles (user_id) values ($1)`, [bob])
    await db.query(`insert into public.profile_skills (user_id, skill) values ($1, 'Navigation')`, [carol])
    await settle()
    expect(received).toEqual([`p:${alice}`, `p:${bob}`, `p:${carol}`])
  })

  it('sends nothing for a change that is rolled back', async () => {
    await expect(db.transaction(async (query) => {
      await query(`update public.profiles set full_name = 'Placeholder Never' where id = $1`, [alice])
      await query(`insert into public.notifications (recipient_id, notification_type) values ($1, 'new_follower')`, [alice])
      throw new Error('rolled back')
    })).rejects.toThrow('rolled back')
    await settle()
    expect(received).toEqual([])
  })

  it('sends c:<id> to the recipient of a notification, and once per transaction however many rows change', async () => {
    await db.transaction(async (query) => {
      for (let i = 0; i < 3; i += 1) {
        await query(`insert into public.notifications (recipient_id, actor_id, notification_type) values ($1, $2, 'new_follower')`, [bob, alice])
      }
    })
    await settle()
    expect(received).toEqual([`c:${bob}`])
    received.length = 0
    await db.query(`update public.notifications set read_at = now() where recipient_id = $1`, [bob])
    await settle()
    expect(received).toEqual([`c:${bob}`])
  })

  it('sends c:<id> to everyone in the conversation for a new message, and to the reader for read state', async () => {
    const [low, high] = [alice, bob].sort()
    const [conversation] = await db.query(
      `insert into public.conversations (direct_user_low_id, direct_user_high_id) values ($1, $2) returning id`, [low, high],
    )
    await db.query(
      `insert into public.conversation_participants (conversation_id, profile_id) values ($1, $2), ($1, $3)`,
      [conversation!.id, alice, bob],
    )
    await settle()
    received.length = 0
    const [message] = await db.query(
      `insert into public.messages (conversation_id, sender_profile_id, client_message_id, body) values ($1, $2, gen_random_uuid(), 'hi') returning id`,
      [conversation!.id, alice],
    )
    await settle()
    expect(received.sort()).toEqual([`c:${alice}`, `c:${bob}`].sort())
    received.length = 0
    await db.query(
      `update public.conversation_participants set last_read_message_id = $3 where conversation_id = $1 and profile_id = $2`,
      [conversation!.id, bob, message!.id],
    )
    await settle()
    expect(received).toEqual([`c:${bob}`])
  })

  it('sends c:<id> to both members for a connection request', async () => {
    const [low, high] = [bob, carol].sort()
    await db.query(
      `insert into public.connections (user_low_id, user_high_id, status, requested_by) values ($1, $2, 'pending', $3)`, [low, high, bob],
    )
    await settle()
    expect(received.sort()).toEqual([`c:${bob}`, `c:${carol}`].sort())
  })

  it('sends s:<origin hash> when a sign-in ends, and nothing for the last-seen touch', async () => {
    const [session] = await db.query(
      `insert into public.auth_sessions (profile_id, token_origin_hash, sign_in_method) values ($1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'password') returning id`, [alice],
    )
    await db.query(`update public.auth_sessions set last_seen_at = now() where id = $1`, [session!.id])
    await settle()
    expect(received).toEqual([])
    await db.query(`update public.auth_sessions set revoked_at = now(), revoke_reason = 'signed_out' where id = $1`, [session!.id])
    await settle()
    expect(received).toEqual(['s:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])
  })

  it('sends i:<subject> when an identity mapping changes', async () => {
    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email) values ($1, 'cognito', 'subject-1', 'placeholder@example.com')`, [carol],
    )
    await settle()
    expect(received).toContain('i:subject-1')
  })
})

describe('the trigger list the app waits for (runtime.ts)', () => {
  it('names exactly the triggers migration 0111 creates', async () => {
    const { CACHE_CLEAR_TRIGGERS } = await import('./runtime')
    const rows = await db.query(`select tgname from pg_trigger where not tgisinternal and tgname like '%\\_cache\\_clear' order by tgname`)
    expect(rows.map((row) => row.tgname)).toEqual([...CACHE_CLEAR_TRIGGERS].sort())
  })
})
