import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createJobsRepository } from '@/features/jobs/repository'
import { createJobAlertSender } from './job-alerts'
import { createJobCandidateSuggestions } from './job-candidates'
import { createRankingEmailPreferences, createRankingEmailRepository, createRankingEmailWorker } from './ranking-email-sending'

/**
 * Round G (G3) against the real schema (PGlite, every migration): the job alert sender sends only
 * new, eligible jobs, at most 10, never twice, nothing when nothing is new, and never to a member
 * who turned the emails off; Suggested candidates lists only members who opted in. Placeholder data.
 */
let db: TestDatabase
let sequence = 0
const at = new Date('2026-10-13T03:00:00.000Z')

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
const transaction = <T,>(work: (run: typeof query) => Promise<T>) => work(query)

async function member(input: { roleKey?: string; admin?: boolean; email?: boolean } = {}) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, role_key, profile_type)
     values (gen_random_uuid(), $1, $2, now(), $3, 'seafarer') returning id`,
    [`Placeholder Member ${sequence}`, `placeholder-member-${sequence}`, input.roleKey ?? 'second_officer'],
  )
  const id = rows[0]!.id as string
  if (input.email !== false) {
    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, true)`,
      [id, `placeholder-sub-${sequence}`, `placeholder-${sequence}@example.invalid`],
    )
  }
  if (input.admin) await db.query(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [id])
  return id
}

async function job(recruiter: string, input: { title?: string; roleKeys?: string[]; publishedAt?: Date; applyUntil?: string | null; minMatch?: number } = {}) {
  sequence += 1
  const rows = await db.query(
    `insert into public.jobs (title, company_name, summary, description, status, created_by_user_id, job_domain, department_key, accepted_role_keys, published_at, created_at, apply_until, min_match_to_apply)
     values ($1, 'Placeholder Lines', 'Placeholder summary', 'Placeholder description', 'published', $2, 'sea', 'deck_officers', $3::text[], $4, $4, $5, $6)
     returning id`,
    [input.title ?? `Placeholder Officer role ${sequence}`, recruiter, input.roleKeys ?? ['second_officer'], (input.publishedAt ?? new Date(at.getTime() - 3_600_000)).toISOString(), input.applyUntil ?? null, input.minMatch ?? 70],
  )
  return rows[0]!.id as string
}

async function alert(userId: string, frequency = 'daily', createdAt = new Date(at.getTime() - 3 * 86_400_000)) {
  const rows = await db.query(
    `insert into public.job_alerts (user_id, name, filters, frequency, created_at) values ($1, 'Placeholder alert', '{"mode":"for-you","ranks":[]}'::jsonb, $2, $3) returning id`,
    [userId, frequency, createdAt.toISOString()],
  )
  return rows[0]!.id as string
}

function sender(mode: 'admins' | 'everyone' = 'everyone', now = at) {
  return createJobAlertSender({ query, transaction, jobs: createJobsRepository({ query: query as never }), modeFor: async () => mode, now: () => now })
}

beforeEach(async () => {
  for (const table of ['ranking_emails', 'job_alert_deliveries', 'member_email_topics', 'notifications', 'job_alerts', 'job_applications', 'jobs', 'member_preferences', 'user_roles', 'identity_accounts', 'maritime_profiles', 'profiles']) {
    await db.query(`delete from public.${table}`)
  }
})

describe('job alert sender (round G)', () => {
  it('queues new eligible jobs only, best first, at most 10, with an in-app notification', async () => {
    const recruiter = await member({ roleKey: 'master' })
    const seafarer = await member()
    await alert(seafarer)
    for (let index = 0; index < 12; index += 1) await job(recruiter)
    const ineligible = await job(recruiter, { title: 'Placeholder Master role', roleKeys: ['master'] })
    const closed = await job(recruiter, { applyUntil: '2026-10-01' })
    const old = await job(recruiter, { publishedAt: new Date(at.getTime() - 20 * 86_400_000) })

    expect(await sender().run()).toMatchObject({ alerts: 1, queued: 1 })
    const emails = await db.query(`select recipient_id, topic, payload from public.ranking_emails`)
    expect(emails).toHaveLength(1)
    const payload = emails[0]!.payload as { jobs: Array<{ id: string }> }
    expect(payload.jobs).toHaveLength(10)
    const ids = payload.jobs.map((item) => item.id)
    for (const excluded of [ineligible, closed, old]) expect(ids).not.toContain(excluded)
    const notifications = await db.query(`select notification_type::text as type, details from public.notifications where recipient_id = $1`, [seafarer])
    expect(notifications).toEqual([{ type: 'job_alert_match', details: expect.objectContaining({ count: 10 }) }])
  })

  it('is idempotent: running again (same day, or after a reset of the schedule) sends nothing twice', async () => {
    const recruiter = await member({ roleKey: 'master' })
    const seafarer = await member()
    const alertId = await alert(seafarer)
    await job(recruiter)
    await job(recruiter)
    await sender().run()
    expect(await sender().run()).toMatchObject({ alerts: 0 })
    // Even when the alert is looked at again (schedule cleared), the delivered jobs are not resent.
    await db.query(`update public.job_alerts set last_checked_at = null, last_sent_at = null where id = $1`, [alertId])
    expect(await sender(undefined, new Date(at.getTime() + 86_400_000)).run()).toMatchObject({ alerts: 1, queued: 0, empty: 1 })
    expect((await db.query(`select count(*)::int as n from public.ranking_emails`))[0]!.n).toBe(1)
    expect((await db.query(`select count(*)::int as n from public.job_alert_deliveries`))[0]!.n).toBe(2)
  })

  it('never alerts a job whose minimum match to apply the member does not meet', async () => {
    const recruiter = await member({ roleKey: 'master' })
    const seafarer = await member()
    await alert(seafarer)
    // Round 12 scores the vessel mismatch below 100; matching v2 still calls both jobs eligible.
    await db.query(`insert into public.maritime_profiles (user_id, vessel_types) values ($1, array['Bulk Carrier'])`, [seafarer])
    const open = await job(recruiter, { minMatch: 0 })
    const gated = await job(recruiter, { minMatch: 100 })
    await db.query(`update public.jobs set vessel_types = array['Oil Tanker'] where id = any($1::uuid[])`, [[open, gated]])
    expect(await sender().run()).toMatchObject({ alerts: 1, queued: 1 })
    const [email] = await db.query(`select payload from public.ranking_emails`)
    const ids = (email!.payload as { jobs: Array<{ id: string }> }).jobs.map((item) => item.id)
    expect(ids).toContain(open)
    expect(ids).not.toContain(gated)
  })

  it('sends nothing when nothing new matches', async () => {
    const recruiter = await member({ roleKey: 'master' })
    const seafarer = await member()
    await alert(seafarer)
    await job(recruiter, { roleKeys: ['master'] })
    expect(await sender().run()).toMatchObject({ alerts: 1, queued: 0, empty: 1 })
    expect((await db.query(`select count(*)::int as n from public.ranking_emails`))[0]!.n).toBe(0)
  })

  it('respects unsubscribe: a member who turned job alert emails off gets nothing queued or sent', async () => {
    const recruiter = await member({ roleKey: 'master' })
    const seafarer = await member()
    await alert(seafarer)
    await job(recruiter)
    await sender().run()
    const [email] = await db.query(`select id from public.ranking_emails`)
    // One-click unsubscribe from that email turns the topic off for its recipient only.
    expect(await createRankingEmailPreferences({ query: query as never }).unsubscribeWithToken(String(email!.id))).toBe('job_alerts')
    const sent: string[] = []
    const worker = createRankingEmailWorker({
      repository: createRankingEmailRepository({ query: query as never, transaction: transaction as never }),
      resend: { sendEmail: async (input) => { sent.push(input.subject); return { messageId: 'placeholder' } } },
    })
    expect(await worker.runSweep()).toMatchObject({ claimed: 1, sent: 0, skipped: 1 })
    expect(sent).toEqual([])
    // Tomorrow's new job is not even queued.
    await job(recruiter, { publishedAt: new Date(at.getTime() + 3_600_000) })
    expect(await sender(undefined, new Date(at.getTime() + 86_400_000)).run()).toMatchObject({ alerts: 0 })
  })

  it('sends a queued alert once, with one-click unsubscribe headers', async () => {
    const recruiter = await member({ roleKey: 'master' })
    const seafarer = await member()
    await alert(seafarer)
    await job(recruiter)
    await sender().run()
    const sent: Array<{ subject: string; headers?: Array<{ Name: string; Value: string }>; idempotencyKey?: string }> = []
    const worker = createRankingEmailWorker({
      repository: createRankingEmailRepository({ query: query as never, transaction: transaction as never }),
      resend: { sendEmail: async (input) => { sent.push(input); return { messageId: 'placeholder' } } },
      siteUrl: 'https://seanshore.example',
    })
    expect(await worker.runSweep()).toMatchObject({ sent: 1 })
    expect(await worker.runSweep()).toMatchObject({ claimed: 0 })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.subject).toBe('1 new job for “Placeholder alert”')
    expect(sent[0]!.headers).toContainEqual({ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' })
    expect(sent[0]!.idempotencyKey).toMatch(/^ranking-email\//)
  })

  it('covers administrators only while the switch is on for admins', async () => {
    const recruiter = await member({ roleKey: 'master' })
    const admin = await member({ admin: true })
    const seafarer = await member()
    await alert(admin)
    await alert(seafarer)
    await job(recruiter)
    expect(await sender('admins').run()).toMatchObject({ alerts: 1, queued: 1 })
    expect((await db.query(`select recipient_id from public.ranking_emails`)).map((row) => row.recipient_id)).toEqual([admin])
  })

  it('waits until 02:00 UTC and sends weekly alerts on Mondays only', async () => {
    const recruiter = await member({ roleKey: 'master' })
    const seafarer = await member()
    await alert(seafarer, 'weekly')
    await job(recruiter)
    expect(await sender('everyone', new Date('2026-10-13T01:00:00.000Z')).run()).toEqual({ waiting: true })
    // 13 October 2026 is a Tuesday.
    expect(await sender().run()).toMatchObject({ alerts: 0 })
    await job(recruiter, { publishedAt: new Date('2026-10-18T10:00:00.000Z') })
    expect(await sender('everyone', new Date('2026-10-19T03:00:00.000Z')).run()).toMatchObject({ alerts: 1, queued: 1 })
  })
})

describe('Suggested candidates (round G)', () => {
  it('lists only members who opted in to recruiters, never the recruiter, blocked members or applicants', async () => {
    const recruiter = await member({ roleKey: 'master' })
    const optedIn = await member()
    const notOptedIn = await member()
    const blocked = await member()
    const applied = await member()
    const ineligible = await member({ roleKey: 'chief_engineer' })
    for (const id of [optedIn, blocked, applied, ineligible, recruiter]) {
      await db.query(`insert into public.member_preferences (profile_id, open_to_recruiters) values ($1, true)`, [id])
    }
    await db.query(`insert into public.member_preferences (profile_id, open_to_recruiters) values ($1, false)`, [notOptedIn])
    await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [blocked, recruiter])
    const jobId = await job(recruiter)
    await db.query(`insert into public.job_applications (job_id, applicant_id) values ($1, $2)`, [jobId, applied])
    const listing = await createJobsRepository({ query: query as never }).getPublishedJob(jobId)

    const found = await createJobCandidateSuggestions({ query }).list(recruiter, listing!)
    expect(found.map((candidate) => candidate.id)).toEqual([optedIn])
    expect(found[0]!.relationship.connection.kind).toBe('none')
    expect(found[0]!.match.reasons.join(' ')).not.toMatch(/visa/i)
  })
})
