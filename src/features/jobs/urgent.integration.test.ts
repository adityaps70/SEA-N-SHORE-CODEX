import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createHiringRepository, type HiringJobInput } from './hiring-repository'
import { createJobsRepository } from './repository'
import { parseJobSearchParams } from './search'
import { URGENT_LIMIT_PER_COMPANY } from './urgent'

/**
 * Round H (H7) against the real schema (PGlite, every migration including 0089): urgent_since is stamped
 * when Urgent is set and cleared when it is unset, urgent lasts 14 days in the listings and the default
 * sort, an organization can have at most 2 live urgent jobs, and the 0089 backfill. Placeholder data only.
 */
const MIGRATION = readFileSync(join(process.cwd(), 'infra/aws/database/migrations/0089_site_fixes_round_h_release_3.sql'), 'utf8')
  .split('-- statement-breakpoint')
  .filter((statement) => statement.split('\n').some((line) => line.trim() && !line.trim().startsWith('--')))

let db: TestDatabase
let owner: string
let companyId: string
let otherCompanyId: string
let sequence = 0

const query = (text: string, values?: readonly unknown[]) => db.query(text, values)
const transaction = <T,>(work: (run: typeof query) => Promise<T>) => db.transaction((tx) => work(tx))

beforeAll(async () => {
  db = await createTestDatabase()
  const [profile] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Recruiter') returning id`)
  owner = String(profile!.id)
  const companies = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified)
     values ('placeholder-lines', 'Placeholder Lines', $1, true), ('placeholder-ship-management', 'Placeholder Ship Management', $1, true)
     returning id`,
    [owner],
  )
  companyId = String(companies[0]!.id)
  otherCompanyId = String(companies[1]!.id)
  await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $3, 'owner', now()), ($2, $3, 'owner', now())`, [companyId, otherCompanyId, owner])
}, 120_000)

afterAll(async () => {
  await db?.close()
})

function hiring() {
  return createHiringRepository({ query, transaction })
}

function jobInput(overrides: Partial<HiringJobInput> = {}): HiringJobInput {
  sequence += 1
  return {
    publisherType: 'organization',
    companyId,
    title: `Placeholder Chief Officer ${sequence}`,
    domain: 'sea',
    department: null,
    rank: null,
    vesselTypes: [],
    location: null,
    regions: [],
    summary: 'Placeholder summary for an urgent test job.',
    description: 'Placeholder description for an urgent test job.',
    requirements: null,
    experienceMinYears: null,
    experienceMaxYears: null,
    joiningFrom: null,
    joiningUntil: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    urgent: false,
    easyApply: true,
    applyUntil: null,
    status: 'published',
    certificates: [],
    visas: [],
    ...overrides,
  }
}

async function urgentRow(jobId: string) {
  const [row] = await db.query(`select urgent, urgent_since from public.jobs where id = $1`, [jobId])
  return row as { urgent: boolean; urgent_since: Date | null }
}

async function clearUrgent() {
  await db.query(`update public.jobs set urgent = false, urgent_since = null`)
}

describe('stamping urgent_since', () => {
  it('stamps it when a job is created urgent, and leaves it empty otherwise', async () => {
    const urgentId = await hiring().createJob(owner, jobInput({ urgent: true }))
    const plainId = await hiring().createJob(owner, jobInput())
    expect((await urgentRow(urgentId)).urgent_since).not.toBeNull()
    expect((await urgentRow(plainId)).urgent_since).toBeNull()
    await clearUrgent()
  })

  it('stamps it when Urgent is set on an edit, keeps it on later edits and clears it when unset', async () => {
    const repo = hiring()
    const jobId = await repo.createJob(owner, jobInput())
    const editable = (await repo.getManagedEditableJob(owner, jobId))!
    const edit = { ...editable, joiningUntil: null }

    await repo.updateJob(owner, jobId, { ...edit, urgent: true }, { expectedStatus: 'published', nextStatus: 'published' })
    const stamped = (await urgentRow(jobId)).urgent_since
    expect(stamped).not.toBeNull()

    await db.query(`update public.jobs set urgent_since = now() - interval '3 days' where id = $1`, [jobId])
    await repo.updateJob(owner, jobId, { ...edit, urgent: true, title: 'Placeholder Chief Officer (edited)' }, { expectedStatus: 'published', nextStatus: 'published' })
    const kept = (await urgentRow(jobId)).urgent_since!
    expect(Date.now() - new Date(kept).getTime()).toBeGreaterThan(2 * 86_400_000)

    await repo.updateJob(owner, jobId, { ...edit, urgent: false }, { expectedStatus: 'published', nextStatus: 'published' })
    expect(await urgentRow(jobId)).toEqual({ urgent: false, urgent_since: null })
    await expect(db.query(`update public.jobs set urgent_since = now() where id = $1`, [jobId])).rejects.toThrow()
    await clearUrgent()
  })

  it('restarts the window when an urgent job is archived and published again', async () => {
    const repo = hiring()
    const jobId = await repo.createJob(owner, jobInput({ urgent: true }))
    await db.query(`update public.jobs set urgent_since = now() - interval '20 days' where id = $1`, [jobId])
    await repo.changeJobStatus(owner, jobId, { from: 'published', to: 'closed', applyUntil: null })
    expect(Date.now() - new Date((await urgentRow(jobId)).urgent_since!).getTime()).toBeGreaterThan(19 * 86_400_000)
    await repo.changeJobStatus(owner, jobId, { from: 'closed', to: 'published', applyUntil: null })
    expect(Date.now() - new Date((await urgentRow(jobId)).urgent_since!).getTime()).toBeLessThan(60_000)
    await clearUrgent()
  })

  it('shows the poster when the urgent window started', async () => {
    const repo = hiring()
    const jobId = await repo.createJob(owner, jobInput({ urgent: true }))
    const managed = await repo.getManagedJob(owner, jobId)
    expect(managed?.urgent).toBe(true)
    expect(managed?.urgentSince).toEqual(expect.any(String))
    await clearUrgent()
  })
})

describe('urgent expires after 14 days in the listings', () => {
  it('filters and sorts only on urgent jobs set less than 14 days ago', async () => {
    const repo = hiring()
    const fresh = await repo.createJob(owner, jobInput({ urgent: true, title: 'Placeholder Fresh Urgent' }))
    const expired = await repo.createJob(owner, jobInput({ urgent: true, companyId: otherCompanyId, title: 'Placeholder Expired Urgent' }))
    await db.query(`update public.jobs set urgent_since = now() - interval '15 days' where id = $1`, [expired])
    const plain = await repo.createJob(owner, jobInput({ title: 'Placeholder Plain Job' }))
    // The expired one is the newest, so only the urgent rule can put the fresh one first.
    await db.query(`update public.jobs set published_at = now() + interval '1 minute' where id = $1`, [expired])

    const jobs = createJobsRepository({ query })
    const urgentOnly = await jobs.searchJobs({ ...parseJobSearchParams({}), urgentOnly: true }, 100)
    expect(urgentOnly.map((job) => job.id)).toContain(fresh)
    expect(urgentOnly.map((job) => job.id)).not.toContain(expired)

    const all = await jobs.searchJobs(parseJobSearchParams({}), 100)
    expect(all[0]?.id).toBe(fresh)
    expect(all.find((job) => job.id === fresh)?.urgent).toBe(true)
    expect(all.find((job) => job.id === expired)?.urgent).toBe(false)
    expect(all.find((job) => job.id === plain)?.urgent).toBe(false)
    await clearUrgent()
  })
})

describe('at most 2 live urgent jobs per organization', () => {
  it('refuses a third live urgent job, counting only live, unexpired, undeleted jobs of the same organization', async () => {
    const repo = hiring()
    for (let index = 0; index < URGENT_LIMIT_PER_COMPANY; index += 1) await repo.createJob(owner, jobInput({ urgent: true }))
    await expect(repo.createJob(owner, jobInput({ urgent: true }))).rejects.toThrow('job_urgent_limit_reached')

    // A draft marked urgent, another organization and a plain job are not limited.
    const draft = await repo.createJob(owner, jobInput({ urgent: true, status: 'draft' }))
    await repo.createJob(owner, jobInput({ urgent: true, companyId: otherCompanyId }))
    const plain = await repo.createJob(owner, jobInput())

    // Publishing the urgent draft or making the plain job urgent is refused too.
    await expect(repo.changeJobStatus(owner, draft, { from: 'draft', to: 'published', applyUntil: null })).rejects.toThrow('job_urgent_limit_reached')
    const editable = (await repo.getManagedEditableJob(owner, plain))!
    await expect(repo.updateJob(owner, plain, { ...editable, joiningUntil: null, urgent: true }, { expectedStatus: 'published', nextStatus: 'published' })).rejects.toThrow('job_urgent_limit_reached')
    expect((await urgentRow(plain)).urgent).toBe(false)

    // Once one of them has been urgent for 14 days, there is room again.
    await db.query(
      `update public.jobs set urgent_since = now() - interval '15 days'
       where id = (select id from public.jobs where company_id = $1 and urgent and status = 'published' order by created_at limit 1)`,
      [companyId],
    )
    await repo.updateJob(owner, plain, { ...editable, joiningUntil: null, urgent: true }, { expectedStatus: 'published', nextStatus: 'published' })
    expect((await urgentRow(plain)).urgent).toBe(true)
    await clearUrgent()
  })
})

describe('migration 0089 backfill', () => {
  it('gives urgent jobs without urgent_since their publish (or creation) date, and is safe to run again', async () => {
    const repo = hiring()
    const published = await repo.createJob(owner, jobInput())
    const draft = await repo.createJob(owner, jobInput({ status: 'draft' }))
    await db.query(`alter table public.jobs drop constraint jobs_urgent_since_check`)
    await db.query(`update public.jobs set urgent = true, urgent_since = null where id = any($1::uuid[])`, [[published, draft]])
    await db.query(`update public.jobs set published_at = now() - interval '5 days' where id = $1`, [published])

    for (const statement of MIGRATION) await db.query(statement)
    for (const statement of MIGRATION) await db.query(statement)

    const rows = await db.query(
      `select id, urgent_since = coalesce(published_at, created_at) as matches from public.jobs where id = any($1::uuid[])`,
      [[published, draft]],
    )
    expect(rows.every((row) => row.matches === true)).toBe(true)
    const [constraint] = await db.query(`select count(*)::int as count from pg_constraint where conname = 'jobs_urgent_since_check'`)
    expect(constraint!.count).toBe(1)
    const [index] = await db.query(`select indexdef from pg_indexes where indexname = 'jobs_company_urgent_idx'`)
    expect(String(index!.indexdef)).toMatch(/WHERE urgent/)
  })
})
