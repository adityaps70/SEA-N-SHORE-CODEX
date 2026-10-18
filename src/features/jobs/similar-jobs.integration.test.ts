import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createHiringRepository, type HiringJobInput } from './hiring-repository'
import { createJobsRepository } from './repository'

/**
 * Hotfix (Oct 2026): "Similar jobs" on the job page against the real schema (PGlite, every migration). The
 * production query failed with a syntax error (42601) and the job page showed none; the unit test only compared
 * SQL fragments. Placeholder data only.
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
    `insert into public.companies (slug, name, created_by, is_verified) values ('placeholder-tankers', 'Placeholder Tankers', $1, true) returning id`,
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
    title: `Placeholder job ${sequence}`,
    domain: 'sea',
    department: null,
    rank: null,
    vesselTypes: [],
    location: null,
    regions: [],
    summary: 'Placeholder summary for a similar jobs test.',
    description: 'Placeholder description for a similar jobs test.',
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

describe('similar jobs on the job page (real schema)', () => {
  it('lists live jobs like this one: same role first, then department, then vessel type, never the job itself', async () => {
    const hiring = createHiringRepository({ query, transaction })
    const jobs = createJobsRepository({ query })
    const create = (overrides: Partial<HiringJobInput>) => hiring.createJob(owner, jobInput(overrides))

    const thisJobId = await create({ rank: 'Chief Officer', acceptedRoleKeys: ['chief_officer'], departmentKey: 'deck_officers', vesselTypes: ['Oil Tanker'] })
    const sameVessel = await create({ title: 'Placeholder Second Engineer', rank: 'Second Engineer', vesselTypes: ['Oil Tanker'] })
    const sameDepartment = await create({ title: 'Placeholder Second Officer', rank: 'Second Officer', departmentKey: 'deck_officers' })
    const sameRole = await create({ title: 'Placeholder Chief Officer', rank: 'Chief Officer', acceptedRoleKeys: ['chief_officer'] })
    await create({ title: 'Placeholder Cook', rank: 'Cook', vesselTypes: ['Bulk Carrier'] })
    await create({ title: 'Placeholder closed Chief Officer', rank: 'Chief Officer', acceptedRoleKeys: ['chief_officer'], applyUntil: '2020-01-01' })

    const thisJob = await jobs.getPublishedJob(thisJobId)
    expect(thisJob).not.toBeNull()
    const similar = await jobs.listSimilarJobs(thisJob!)
    expect(similar.map((job) => job.id)).toEqual([sameRole, sameDepartment, sameVessel])

    // An older job with only rank text, and a limit above the cap.
    const older = await jobs.listSimilarJobs({ id: sameVessel, rank: 'chief officer', department: null, vesselTypes: [] }, 50)
    expect(older.map((job) => job.id)).toEqual([sameRole, thisJobId])
  })
})
