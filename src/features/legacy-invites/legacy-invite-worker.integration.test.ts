import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { ResendApiError } from '@/lib/email/resend'

/**
 * The first-invitation worker against the real schema (PGlite): a sweep that stops on a retryable Resend error must
 * not leave the invitations it claimed but never tried in 'sending', where no sweep picks them up and Stop cannot
 * cancel them. Placeholder data.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { createLegacyInviteWorker } = await import('./sending')
const { legacyInviteRepository } = await import('./repository')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function queuedInvite(index: number) {
  const email = `fixture-first-${index}@example.test`
  const profileId = (await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [`Fixture First ${index}`]))[0]!.id
  await db.query(
    `insert into public.legacy_profile_claims (source_system, legacy_object, legacy_id, profile_id, email) values ('beaufortmarine', 'user', $1, $2, $3)`,
    [index, profileId, email],
  )
  // queued_at in index order, so the worker claims them in a known order.
  await db.query(
    `insert into public.legacy_profile_invites (profile_id, email, status, attempts, queued_at)
     values ($1, $2, 'queued', 0, now() - make_interval(mins => $3))`,
    [profileId, email, 10 - index],
  )
  return email
}

describe('first-invitation worker after a retryable error', () => {
  it('puts the untried invitations back in the queue, unchanged, and the next sweep sends them', async () => {
    const emails = [await queuedInvite(1), await queuedInvite(2), await queuedInvite(3)]
    const busy = { sendEmail: vi.fn(async () => { throw new ResendApiError('rate_limit_exceeded', 429, 'Too many requests') }) }
    await expect(createLegacyInviteWorker({ resend: busy }).runSweep(5)).resolves.toMatchObject({ claimed: 3, retrying: 1 })

    const after = await db.query(`select email, status, attempts from public.legacy_profile_invites order by queued_at`)
    expect(after).toEqual([
      { email: emails[0], status: 'queued', attempts: 1 },
      { email: emails[1], status: 'queued', attempts: 0 },
      { email: emails[2], status: 'queued', attempts: 0 },
    ])
    expect(await db.query(`select 1 from public.legacy_profile_invites where status = 'sending'`)).toHaveLength(0)

    // The untried ones are claimable straight away; the one that hit the error waits for its back-off.
    let count = 0
    const healthy = { sendEmail: vi.fn<(input: { to: string }) => Promise<{ messageId: string }>>(async () => ({ messageId: `message-${++count}` })) }
    await expect(createLegacyInviteWorker({ resend: healthy }).runSweep(5)).resolves.toMatchObject({ claimed: 2, sent: 2 })
    expect(healthy.sendEmail.mock.calls.map(([input]) => input.to)).toEqual([emails[1], emails[2]])
  })

  it('release only touches an invitation that is still sending', async () => {
    const email = await queuedInvite(4)
    const id = (await db.query(
      `update public.legacy_profile_invites set status = 'sent', attempts = 1, sent_at = now() where email = $1 returning id`,
      [email],
    ))[0]!.id as string
    await legacyInviteRepository.release(id)
    expect((await db.query(`select status, attempts from public.legacy_profile_invites where id = $1`, [id]))[0]).toEqual({ status: 'sent', attempts: 1 })
  })
})
