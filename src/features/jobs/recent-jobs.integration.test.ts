import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createHiringRepository, type HiringJobInput } from './hiring-repository'
import { createJobsRepository } from './repository'
import { parseJobSearchParams } from './search'

/**
 * Bug fix (13 Nov): "Recently Posted" against the real schema (PGlite, every migration). Strictly newest first by
 * publish time: urgent and verified no longer jump ahead, a job published a minute ago is first, and an older
 * draft published today counts from today. Placeholder data only.
 */
let db: TestDatabase
let owner: string
let companyId: string
let sequence = 0

const query = (text: string, values?: readonly unknown[]) => db.query(text, values)
const transaction = <T,>(work: (run: typeof query) => Promise<T>) => db.transaction((tx) => work(tx))

beforeAll(async () => {
  db = await createTestDatabase()
  const [profile] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Recruiter') returning id`)
  owner = String(profile!.id)
  const [company] = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified) values ('placeholder-recent-lines', 'Placeholder Recent Lines', $1, true) returning id`,
    [owner],
  )
  companyId = String(company!.id)
  await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, 'owner', now())`, [companyId, owner])
}, 120_000)

afterAll(async () => {
  await db?.close()
})

function jobInput(overrides: Partial<HiringJobInput> = {}): HiringJobInput {
  sequence += 1
  return {
    publisherType: 'organization',
    companyId,
    title: `Placeholder recent job ${sequence}`,
    domain: 'sea',
    department: null,
    rank: null,
    vesselTypes: [],
    location: null,
    regions: [],
    summary: 'Placeholder summary for a recently posted test.',
    description: 'Placeholder description for a recently posted test, long enough for the job rules to accept it as a real one.',
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

describe('Recently Posted (real schema)', () => {
  it('lists jobs strictly by publish time, newest first, and a job published 1 minute ago comes first', async () => {
    const hiring = createHiringRepository({ query, transaction })
    const jobs = createJobsRepository({ query })
    const at = async (id: string, minutesAgo: number, createdDaysAgo = 0) => {
      await db.query(
        `update public.jobs set published_at = now() - ($2::int * interval '1 minute'), created_at = now() - ($3::int * interval '1 day') where id = $1`,
        [id, minutesAgo, createdDaysAgo],
      )
    }
    const urgentOld = await hiring.createJob(owner, jobInput({ urgent: true }))
    await at(urgentOld, 3 * 24 * 60)
    const yesterday = await hiring.createJob(owner, jobInput())
    await at(yesterday, 24 * 60)
    // Drafted 20 days ago, published 2 hours ago: counts from its publish time.
    const publishedToday = await hiring.createJob(owner, jobInput())
    await at(publishedToday, 120, 20)
    const minuteAgo = await hiring.createJob(owner, jobInput())
    await at(minuteAgo, 1)
    const tooOld = await hiring.createJob(owner, jobInput())
    await at(tooOld, 10 * 24 * 60)

    const filters = parseJobSearchParams({ mode: 'recent' })
    expect(filters.sort).toBe('recent')
    const listed = await jobs.searchJobs(filters, 21, 0)
    expect(listed.map((job) => job.id)).toEqual([minuteAgo, publishedToday, yesterday, urgentOld])
    const times = listed.map((job) => Date.parse(job.publishedAt!))
    expect(times).toEqual([...times].sort((a, b) => b - a))

    // Under Recommended (default sort, Sea Jobs) the urgent job still leads, as before.
    const recommended = await jobs.searchJobs(parseJobSearchParams({ mode: 'sea' }), 21, 0)
    expect(recommended[0]!.id).toBe(urgentOld)
  })
})
