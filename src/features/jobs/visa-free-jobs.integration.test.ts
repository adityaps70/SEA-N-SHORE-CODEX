import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createJobAlertSender } from '@/features/ranking/job-alerts'
import { createJobsQueries } from './queries'
import { createJobsRepository } from './repository'
import { parseJobSearchParams } from './search'

/**
 * Hotfix P5 against the real schema (PGlite, every migration): visa is never a search filter, a
 * match term or eligibility. A job whose visa is "N/A" and a member whose visa is "B1/B2" (and the
 * reverse) see the job in search, For You (both matching versions) and alerts, with no visa line in
 * the match. Placeholder data only.
 */
let db: TestDatabase
let sequence = 0
const at = new Date('2026-10-30T03:00:00.000Z')

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
const transaction = <T,>(work: (run: typeof query) => Promise<T>) => work(query)
const repository = () => createJobsRepository({ query: query as never })

async function member(visas: string[] = [], roleKey = 'second_officer') {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, role_key, profile_type)
     values (gen_random_uuid(), $1, $2, now(), $3, 'seafarer') returning id`,
    [`Placeholder Member ${sequence}`, `placeholder-member-${sequence}`, roleKey],
  )
  const id = rows[0]!.id as string
  await db.query(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, true)`,
    [id, `placeholder-sub-${sequence}`, `placeholder-${sequence}@example.invalid`],
  )
  for (const visa of visas) await db.query(`insert into public.profile_visas (profile_id, visa_type) values ($1, $2)`, [id, visa])
  return id
}

async function job(recruiter: string, visas: Array<{ name: string; required: boolean }>) {
  sequence += 1
  const rows = await db.query(
    `insert into public.jobs (title, company_name, summary, description, status, created_by_user_id, job_domain, department_key, accepted_role_keys, published_at, created_at, min_match_to_apply)
     values ($1, 'Placeholder Lines', 'Placeholder summary', 'Placeholder description', 'published', $2, 'sea', 'deck_officers', array['second_officer'], $3, $3, 70)
     returning id`,
    [`Placeholder Officer role ${sequence}`, recruiter, new Date(at.getTime() - 3_600_000).toISOString()],
  )
  const id = rows[0]!.id as string
  for (const visa of visas) await db.query(`insert into public.job_visa_requirements (job_id, visa_name, required) values ($1, $2, $3)`, [id, visa.name, visa.required])
  return id
}

function forYou(viewer: string, v2: boolean) {
  return createJobsQueries({
    requireUser: async () => ({ id: viewer } as never),
    repository: repository(),
    ranking: { isEnabled: async () => v2 },
  })
}

beforeEach(async () => {
  for (const table of ['ranking_emails', 'job_alert_deliveries', 'notifications', 'job_alerts', 'job_visa_requirements', 'jobs', 'profile_visas', 'identity_accounts', 'profiles']) {
    await db.query(`delete from public.${table}`)
  }
})

describe('visa is never compared (hotfix P5)', () => {
  const cases = [
    { name: 'job "N/A", member "B1/B2"', jobVisa: 'N/A', memberVisas: ['B1/B2'] },
    { name: 'job "B1/B2", member "N/A"', jobVisa: 'B1/B2', memberVisas: ['N/A'] },
    { name: 'job "US C1/D", member without visas', jobVisa: 'US C1/D', memberVisas: [] },
  ]

  for (const item of cases) {
    it(`${item.name}: the job shows in For You (v2 and round 12) as eligible, with no visa line`, async () => {
      const recruiter = await member([], 'master')
      const seafarer = await member(item.memberVisas)
      const id = await job(recruiter, [{ name: item.jobVisa, required: true }])
      for (const v2 of [true, false]) {
        const result = await forYou(seafarer, v2).getJobsDiscovery({ mode: 'for-you' })
        const found = result.items.find((entry) => entry.job.id === id)
        expect(found, `For You ${v2 ? 'v2' : 'round 12'}`).toBeDefined()
        expect(found!.match?.eligible ?? true).toBe(true)
        expect(found!.match?.score).toBe(v2 ? 75 : 100)
        expect(found!.match?.checks?.some((check) => check.label === 'Visa') ?? false).toBe(false)
        expect(found!.match?.missingRequirements).not.toContain(item.jobVisa)
        expect(JSON.stringify(found!.match)).not.toMatch(/visa/i)
      }
      // The job page match ("Check before applying") agrees.
      const detail = await forYou(seafarer, true).getJobDetailState(id)
      expect(detail.match?.eligible).toBe(true)
      expect(JSON.stringify(detail.match)).not.toMatch(/visa/i)
    })
  }

  it('search: an old URL with a visa parameter returns the same jobs as without it', async () => {
    const recruiter = await member([], 'master')
    const ids = [
      await job(recruiter, [{ name: 'N/A', required: true }]),
      await job(recruiter, [{ name: 'US C1/D', required: true }]),
      await job(recruiter, [{ name: 'Schengen', required: false }]),
      await job(recruiter, []),
    ]
    const jobs = repository()
    const without = await jobs.searchJobs(parseJobSearchParams({ mode: 'sea', sort: 'recent' }), 50, 0)
    expect(without.map((item) => item.id).sort()).toEqual([...ids].sort())
    for (const visa of ['US C1/D', 'N/A', 'B1/B2']) {
      const withVisa = await jobs.searchJobs(parseJobSearchParams({ mode: 'sea', sort: 'recent', visa }), 50, 0)
      expect(withVisa.map((item) => item.id)).toEqual(without.map((item) => item.id))
    }
  })

  it('alerts: a saved alert with a visa condition still matches on its other conditions', async () => {
    const recruiter = await member([], 'master')
    const seafarer = await member(['B1/B2'])
    await db.query(
      `insert into public.job_alerts (user_id, name, filters, frequency, created_at)
       values ($1, 'Placeholder alert', '{"mode":"sea","ranks":["second_officer"],"visas":["US C1/D"]}'::jsonb, 'daily', $2)`,
      [seafarer, new Date(at.getTime() - 3 * 86_400_000).toISOString()],
    )
    const naJob = await job(recruiter, [{ name: 'N/A', required: true }])
    const usJob = await job(recruiter, [{ name: 'US C1/D', required: true }])
    const noVisaJob = await job(recruiter, [])
    // A job the alert's other condition (rank) leaves out stays out.
    const masterJob = await job(recruiter, [])
    await db.query(`update public.jobs set accepted_role_keys = array['master'] where id = $1`, [masterJob])

    const sender = createJobAlertSender({ query, transaction, jobs: repository(), modeFor: async () => 'everyone', now: () => at })
    expect(await sender.run()).toMatchObject({ alerts: 1, queued: 1 })
    const [email] = await db.query(`select payload from public.ranking_emails`)
    const sent = (email!.payload as { jobs: Array<{ id: string }> }).jobs.map((item) => item.id)
    expect(sent.sort()).toEqual([naJob, usJob, noVisaJob].sort())
  })

  it('keeps the visa data: nothing is deleted from jobs or profiles', async () => {
    const recruiter = await member([], 'master')
    const seafarer = await member(['N/A', 'B1/B2'])
    const id = await job(recruiter, [{ name: 'N/A', required: true }])
    await forYou(seafarer, true).getJobsDiscovery({ mode: 'for-you' })
    expect((await db.query(`select visa_name from public.job_visa_requirements where job_id = $1`, [id])).map((row) => row.visa_name)).toEqual(['N/A'])
    expect((await db.query(`select count(*)::int as n from public.profile_visas where profile_id = $1`, [seafarer]))[0]!.n).toBe(2)
  })
})
