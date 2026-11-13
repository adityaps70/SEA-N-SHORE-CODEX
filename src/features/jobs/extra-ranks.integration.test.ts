import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createOrganizationWorkspaceRepository } from '@/features/organizations/workspace-repository'
import { SUGGESTION_WEIGHTS } from '@/features/ranking/suggestion-weights'
import { createExtraRanksRepository } from './extra-ranks-repository'
import { createHiringRepository, type HiringJobInput } from './hiring-repository'
import { createJobsRepository } from './repository'
import { parseJobSearchParams } from './search'

/**
 * P6 (owner-approved 13 Nov): ranks from other departments on a job, against the real schema (PGlite, every
 * migration including 0103). Placeholder data only.
 */
let db: TestDatabase
let posterA: string
let posterB: string
let admin: string
let companyId: string
let sequence = 0

const query = (text: string, values?: readonly unknown[]) => db.query(text, values)
const transaction = <T,>(work: (run: typeof query) => Promise<T>) => db.transaction((tx) => work(tx))

beforeAll(async () => {
  db = await createTestDatabase()
  const people = await db.query(
    `insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder A'), (gen_random_uuid(), 'Placeholder B'), (gen_random_uuid(), 'Placeholder Admin') returning id`,
  )
  ;[posterA, posterB, admin] = people.map((row) => String(row.id)) as [string, string, string]
  const [company] = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified) values ('placeholder-marine', 'Placeholder Marine', $1, true) returning id`,
    [posterA],
  )
  companyId = String(company!.id)
  // Two posters from the same placeholder organization (each still sees the department's shared extras).
  await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, 'owner', now()), ($1, $3, 'recruiter', now())`, [companyId, posterA, posterB])
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
    domain: 'shore',
    department: null,
    rank: null,
    vesselTypes: [],
    location: null,
    regions: [],
    summary: 'Placeholder summary for an extra ranks test.',
    description: 'Placeholder description for an extra ranks test, long enough for the job rules to accept it as a real one.',
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

describe('P6 ranks from other departments (real schema)', () => {
  it('shares a department\'s extras with every poster, most used first, never under another department, and an admin can hide one', async () => {
    const hiring = createHiringRepository({ query, transaction })
    const extras = createExtraRanksRepository({ query: query as never, transaction: transaction as never })
    const jobs = createJobsRepository({ query })

    // Poster A: an HSEQ & Vetting job that also accepts Master and Chief Officer. Both save.
    const first = await hiring.createJob(posterA, jobInput({ departmentKey: 'hseq_vetting', acceptedRoleKeys: ['vetting_manager', 'master', 'chief_officer'] }))
    const [saved] = await db.query(`select accepted_role_keys from public.jobs where id = $1`, [first])
    expect(saved!.accepted_role_keys).toEqual(['vetting_manager', 'master', 'chief_officer'])

    // Another poster's new HSEQ job offers both as options; another department offers none.
    // (A tie in use and first-added time falls back to the rank key.)
    expect(await extras.listShown('hseq_vetting')).toEqual([
      { roleKey: 'chief_officer', timesUsed: 1 },
      { roleKey: 'master', timesUsed: 1 },
    ])
    expect(await extras.listShown('catering')).toEqual([])
    expect(Object.keys(await extras.listShownByDepartment())).toEqual(['hseq_vetting'])

    // Poster B uses Chief Officer too: it moves first (most used).
    const second = await hiring.createJob(posterB, jobInput({ departmentKey: 'hseq_vetting', acceptedRoleKeys: ['hseq_manager', 'chief_officer'] }))
    expect((await extras.listShown('hseq_vetting')).map((entry) => [entry.roleKey, entry.timesUsed])).toEqual([['chief_officer', 2], ['master', 1]])

    // Poster A drops Master: its count goes to 0, the link stays.
    await hiring.updateJob(posterA, first, jobInput({ departmentKey: 'hseq_vetting', acceptedRoleKeys: ['vetting_manager', 'chief_officer'] }), { expectedStatus: 'published', nextStatus: 'published' })
    expect((await extras.listShown('hseq_vetting')).map((entry) => [entry.roleKey, entry.timesUsed])).toEqual([['chief_officer', 2], ['master', 0]])

    // The jobs count under their own department and under the extras' department (deck officers), not elsewhere.
    const deck = await jobs.searchJobs(parseJobSearchParams({ mode: 'all', department: 'deck_officers' }))
    expect(deck.map((job) => job.id).sort()).toEqual([first, second].sort())
    const engine = await jobs.searchJobs(parseJobSearchParams({ mode: 'all', department: 'engine_officers' }))
    expect(engine.map((job) => job.id)).toEqual([])

    // Organization suggestions: "Open jobs for your rank" for a deck member (department only), not an engine one.
    const [viewer] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Viewer') returning id`)
    const orgs = createOrganizationWorkspaceRepository({ query: query as never })
    const suggest = (departmentKeys: string[]) => orgs.listDiscoverOrganizationsForYou(String(viewer!.id), { limit: 20, departmentKeys, rankBandKeys: [], cadet: false, weights: SUGGESTION_WEIGHTS.orgs })
    expect((await suggest(['deck_officers'])).find((org) => org.id === companyId)?.reason).toBe('Open jobs for your rank')
    expect((await suggest(['engine_officers'])).find((org) => org.id === companyId)?.reason ?? null).not.toBe('Open jobs for your rank')

    // Admin hides Chief Officer: gone from future forms, existing jobs keep it, audit event written.
    await expect(extras.setHidden(admin, 'hseq_vetting', 'chief_officer', true)).resolves.toBe(true)
    expect((await extras.listShown('hseq_vetting')).map((entry) => entry.roleKey)).toEqual(['master'])
    const kept = await db.query(`select id from public.jobs where 'chief_officer' = any(accepted_role_keys) order by id`)
    expect(kept.map((row) => String(row.id)).sort()).toEqual([first, second].sort())
    const all = await extras.listAll()
    expect(all.find((link) => link.roleKey === 'chief_officer')).toMatchObject({ departmentKey: 'hseq_vetting', hidden: true, timesUsed: 2 })
    const [audit] = await db.query(`select action, target_id from public.audit_events where actor_id = $1 order by created_at desc limit 1`, [admin])
    expect(audit).toMatchObject({ action: 'job_extra_rank_hidden', target_id: 'hseq_vetting:chief_officer' })

    // A new job with the hidden rank keeps it hidden (still counted); showing it again brings it back.
    await hiring.createJob(posterB, jobInput({ departmentKey: 'hseq_vetting', acceptedRoleKeys: ['dpa', 'chief_officer'] }))
    expect((await extras.listShown('hseq_vetting')).map((entry) => entry.roleKey)).toEqual(['master'])
    await extras.setHidden(admin, 'hseq_vetting', 'chief_officer', false)
    expect((await extras.listShown('hseq_vetting')).map((entry) => [entry.roleKey, entry.timesUsed])).toEqual([['chief_officer', 3], ['master', 0]])
    await expect(extras.setHidden(admin, 'hseq_vetting', 'cook', true)).resolves.toBe(false)

    // Deleting a (draft) job lowers the count again.
    const draft = await hiring.createJob(posterA, jobInput({ departmentKey: 'hseq_vetting', acceptedRoleKeys: ['cso', 'master'], status: 'draft' }))
    expect((await extras.listShown('hseq_vetting')).find((entry) => entry.roleKey === 'master')?.timesUsed).toBe(1)
    await hiring.deleteJob(posterA, draft, 'draft')
    expect((await extras.listShown('hseq_vetting')).find((entry) => entry.roleKey === 'master')?.timesUsed).toBe(0)
  })

  it('keeps an old typed Other rank exactly as typed and adds the column for the reversible conversion', async () => {
    const [column] = await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'jobs' and column_name = 'role_other_text_original'`)
    expect(column!.n).toBe(1)
    const hiring = createHiringRepository({ query, transaction })
    const id = await hiring.createJob(posterA, jobInput({ departmentKey: 'catering', acceptedRoleKeys: ['other_catering'], roleOtherText: 'Galley helper' }))
    const [row] = await db.query(`select role_other_text, role_other_text_original from public.jobs where id = $1`, [id])
    expect(row).toMatchObject({ role_other_text: 'Galley helper', role_other_text_original: null })
    expect((await createExtraRanksRepository({ query: query as never, transaction: transaction as never }).listShown('catering'))).toEqual([])
  })
})
