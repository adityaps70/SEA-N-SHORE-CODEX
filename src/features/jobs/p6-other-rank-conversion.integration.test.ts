import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { matchOtherRankText } from '@/features/roles/other-rank-matcher'
import { normaliseRoleText, otherRoleKeyFor } from '@/features/roles/taxonomy'
import { createHiringRepository, type HiringJobInput } from './hiring-repository'

/**
 * P6 (owner-approved 13 Nov): the conversion of the 3 clear typed "Other" ranks (data fix run by the P6 runner's
 * convert-once action) and its revert, against the real schema (PGlite, every migration). Placeholder data only.
 */
const statements = (name: string) => readFileSync(join(process.cwd(), `infra/aws/database/data-fixes/${name}.sql`), 'utf8')
  .split('-- statement-breakpoint')
  .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
  .filter(Boolean)

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
  const [company] = await db.query(`insert into public.companies (slug, name, created_by, is_verified) values ('placeholder-convert', 'Placeholder Convert', $1, true) returning id`, [owner])
  companyId = String(company!.id)
  await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, 'owner', now())`, [companyId, owner])
}, 120_000)

afterAll(async () => {
  await db?.close()
})

function jobInput(overrides: Partial<HiringJobInput>): HiringJobInput {
  sequence += 1
  return {
    publisherType: 'organization', companyId, title: `Placeholder job ${sequence}`, domain: 'shore', department: null, rank: null,
    vesselTypes: [], location: null, regions: [], summary: 'Placeholder summary.', description: 'Placeholder description long enough for a job.',
    requirements: null, experienceMinYears: null, experienceMaxYears: null, joiningFrom: null, joiningUntil: null, salaryMin: null,
    salaryMax: null, salaryCurrency: null, salaryPeriod: null, urgent: false, easyApply: true, applyUntil: null, status: 'published',
    certificates: [], visas: [], ...overrides,
  }
}

async function run(name: string) {
  for (const statement of statements(name)) await db.query(statement)
}
async function job(id: string) {
  const [row] = await db.query(`select accepted_role_keys, role_other_text, role_other_text_original from public.jobs where id = $1`, [id])
  return row as { accepted_role_keys: string[]; role_other_text: string | null; role_other_text_original: string | null }
}
async function links() {
  const rows = await db.query(`select department_key, role_key, times_used from public.job_department_extra_ranks order by department_key, role_key`)
  return rows.map((row) => `${row.department_key}:${row.role_key}=${row.times_used}`)
}

describe('P6 typed Other conversion (real schema)', () => {
  it('converts only texts the matcher reads the same way (the preview the owner approved)', () => {
    const sql = readFileSync(join(process.cwd(), 'infra/aws/database/data-fixes/p6_other_rank_conversion.sql'), 'utf8')
    const tuples = [...sql.matchAll(/\('([a-z ]+)', array\[([^\]]*)\]::text\[\]\)/g)].map((m) => [m[1]!, [...m[2]!.matchAll(/'([a-z_]+)'/g)].map((k) => k[1]!)] as const)
    expect(tuples).toHaveLength(6)
    // A typed form of each approved text: it normalises to the SQL pattern, and the matcher reads the same ranks.
    const typed: Record<string, string> = { 'chief engineer': 'Chief Engineer', 'master chief officer': 'Master/ Chief officer', 'master mariner': 'Master Mariner' }
    for (const [pattern, keys] of tuples) {
      expect(normaliseRoleText(typed[pattern]!), pattern).toBe(pattern)
      expect(matchOtherRankText(typed[pattern]), pattern).toEqual(keys)
    }
  })

  it('converts exactly the 3 approved texts, keeps the typed text, leaves the unclear one, and reverts exactly', async () => {
    const hiring = createHiringRepository({ query, transaction })
    const other = (departmentKey: string, text: string, extra: string[] = []) =>
      hiring.createJob(owner, jobInput({ departmentKey, acceptedRoleKeys: [...extra, otherRoleKeyFor(departmentKey)], roleOtherText: text }))
    const chiefEngineer = await other('technical_fleet', 'Chief Engineer', ['technical_superintendent'])
    const masterChiefOfficer = await other('hseq_vetting', 'Master/ Chief officer')
    const masterMariner = await other('deck_officers', 'Master Mariner')
    const unclear = await other('catering', 'Galley helper')
    const deleted = await other('technical_fleet', 'chief engineer')
    await db.query(`update public.jobs set deleted_at = now() where id = $1`, [deleted])

    await run('p6_other_rank_conversion')

    expect(await job(chiefEngineer)).toEqual({ accepted_role_keys: ['technical_superintendent', 'chief_engineer'], role_other_text: null, role_other_text_original: 'Chief Engineer' })
    expect(await job(masterChiefOfficer)).toEqual({ accepted_role_keys: ['master', 'chief_officer'], role_other_text: null, role_other_text_original: 'Master/ Chief officer' })
    expect(await job(masterMariner)).toEqual({ accepted_role_keys: ['master'], role_other_text: null, role_other_text_original: 'Master Mariner' })
    expect(await job(unclear)).toEqual({ accepted_role_keys: ['other_catering'], role_other_text: 'Galley helper', role_other_text_original: null })
    expect((await job(deleted)).role_other_text_original).toBeNull()
    // The new extras of other departments are shared under the job's department (Master on a deck job is its own rank).
    expect(await links()).toEqual(['hseq_vetting:chief_officer=1', 'hseq_vetting:master=1', 'technical_fleet:chief_engineer=1'])
    const [audits] = await db.query(`select count(*)::int as n from public.audit_events where action = 'p6_other_rank_converted'`)
    expect(audits!.n).toBe(3)

    // Running it again changes nothing.
    await run('p6_other_rank_conversion')
    const [again] = await db.query(`select count(*)::int as n from public.audit_events where action = 'p6_other_rank_converted'`)
    expect(again!.n).toBe(3)
    expect((await job(chiefEngineer)).accepted_role_keys).toEqual(['technical_superintendent', 'chief_engineer'])

    // Revert restores the original ranks and text word for word; the links drop to 0.
    await run('p6_other_rank_conversion_revert')
    expect(await job(chiefEngineer)).toEqual({ accepted_role_keys: ['technical_superintendent', 'other_technical_fleet'], role_other_text: 'Chief Engineer', role_other_text_original: null })
    expect(await job(masterChiefOfficer)).toEqual({ accepted_role_keys: ['other_hseq_vetting'], role_other_text: 'Master/ Chief officer', role_other_text_original: null })
    expect(await job(masterMariner)).toEqual({ accepted_role_keys: ['other_deck_officers'], role_other_text: 'Master Mariner', role_other_text_original: null })
    expect(await job(unclear)).toEqual({ accepted_role_keys: ['other_catering'], role_other_text: 'Galley helper', role_other_text_original: null })
    expect(await links()).toEqual(['hseq_vetting:chief_officer=0', 'hseq_vetting:master=0', 'technical_fleet:chief_engineer=0'])
    const [reverted] = await db.query(`select count(*)::int as n from public.audit_events where action = 'p6_other_rank_reverted'`)
    expect(reverted!.n).toBe(3)
    await run('p6_other_rank_conversion_revert')
    const [revertedAgain] = await db.query(`select count(*)::int as n from public.audit_events where action = 'p6_other_rank_reverted'`)
    expect(revertedAgain!.n).toBe(3)
  })
})
