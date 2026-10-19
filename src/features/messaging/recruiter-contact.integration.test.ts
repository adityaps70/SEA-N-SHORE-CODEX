import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createHiringRepository, type HiringJobInput } from '@/features/jobs/hiring-repository'
import { createMessagingRepository } from './repository'
import { createRecruiterContactRepository } from './recruiter-contact-repository'

/**
 * Recruiter messaging exception (Oct 2026) against the real schema (PGlite, every migration including 0091): who
 * counts as a verified recruiter, which applications count, "open to recruiters", the daily count and the reason
 * row. Placeholder data only.
 */
let db: TestDatabase
let sequence = 0
const query = (text: string, values?: readonly unknown[]) => db.query(text, values)
const transaction = <T,>(work: (run: typeof query) => Promise<T>) => db.transaction((tx) => work(tx))
const recruiters = () => createRecruiterContactRepository({ query })

async function profile(name: string) {
  const [row] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [name])
  return String(row!.id)
}

async function company(createdBy: string, verified: boolean) {
  sequence += 1
  const [row] = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified) values ($1, $2, $3, $4) returning id`,
    [`placeholder-org-${sequence}`, `Placeholder Org ${sequence}`, createdBy, verified],
  )
  return String(row!.id)
}

async function member(companyId: string, userId: string, role: string, approved = true) {
  await db.query(
    `insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, $3, ${approved ? 'now()' : 'null'})`,
    [companyId, userId, role],
  )
}

function jobInput(overrides: Partial<HiringJobInput>): HiringJobInput {
  sequence += 1
  return {
    publisherType: 'organization', companyId: null, title: `Placeholder Chief Officer ${sequence}`, domain: 'sea', department: null, rank: null,
    vesselTypes: [], location: null, regions: [], summary: 'Placeholder summary.', description: 'Placeholder description.', requirements: null,
    experienceMinYears: null, experienceMaxYears: null, joiningFrom: null, joiningUntil: null, salaryMin: null, salaryMax: null,
    salaryCurrency: null, salaryPeriod: null, urgent: false, easyApply: true, applyUntil: null, status: 'published', certificates: [], visas: [],
    ...overrides,
  }
}

async function apply(jobId: string, applicantId: string, status = 'applied') {
  const [row] = await db.query(
    `insert into public.job_applications (job_id, applicant_id, status) values ($1, $2, $3::public.job_application_status) returning id`,
    [jobId, applicantId, status],
  )
  return String(row!.id)
}

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('who counts as a verified recruiter', () => {
  it('a personal recruiter verification, or an approved hiring role in a verified organization', async () => {
    const personal = await profile('Placeholder Personal Recruiter')
    await db.query(`insert into public.feature_verifications (profile_id, verification_type, status) values ($1, 'recruiter', 'approved')`, [personal])
    const pending = await profile('Placeholder Pending Recruiter')
    await db.query(`insert into public.feature_verifications (profile_id, verification_type, status) values ($1, 'recruiter', 'pending')`, [pending])

    const owner = await profile('Placeholder Org Owner')
    const verifiedOrg = await company(owner, true)
    const unverifiedOrg = await company(owner, false)
    const orgRecruiter = await profile('Placeholder Org Recruiter')
    await member(verifiedOrg, orgRecruiter, 'recruiter')
    const plainMember = await profile('Placeholder Org Member')
    await member(verifiedOrg, plainMember, 'member')
    const unapproved = await profile('Placeholder Unapproved Recruiter')
    await member(verifiedOrg, unapproved, 'recruiter', false)
    const unverifiedOrgRecruiter = await profile('Placeholder Unverified Org Recruiter')
    await member(unverifiedOrg, unverifiedOrgRecruiter, 'recruiter')

    const repo = recruiters()
    expect(await repo.isVerifiedRecruiter(personal)).toBe(true)
    expect(await repo.isVerifiedRecruiter(orgRecruiter)).toBe(true)
    expect(await repo.isVerifiedRecruiter(pending)).toBe(false)
    expect(await repo.isVerifiedRecruiter(plainMember)).toBe(false)
    expect(await repo.isVerifiedRecruiter(unapproved)).toBe(false)
    expect(await repo.isVerifiedRecruiter(unverifiedOrgRecruiter)).toBe(false)
  })
})

describe('which applications count', () => {
  it('an application (not withdrawn) to a live job the recruiter may manage, by that applicant', async () => {
    const owner = await profile('Placeholder Hiring Owner')
    const org = await company(owner, true)
    await member(org, owner, 'owner')
    const colleague = await profile('Placeholder Colleague Recruiter')
    await member(org, colleague, 'recruiter')
    const outsider = await profile('Placeholder Outsider Recruiter')
    await db.query(`insert into public.feature_verifications (profile_id, verification_type, status) values ($1, 'recruiter', 'approved')`, [outsider])
    const applicant = await profile('Placeholder Applicant')
    const otherApplicant = await profile('Placeholder Other Applicant')

    const hiring = createHiringRepository({ query, transaction })
    const jobId = await hiring.createJob(owner, jobInput({ companyId: org }))
    const applicationId = await apply(jobId, applicant)
    const withdrawnId = await apply(jobId, otherApplicant, 'withdrawn')

    const repo = recruiters()
    // Any approved hiring member of the verified organization, not just the poster.
    expect(await repo.findApplicationForRecruiter(colleague, applicant, applicationId)).toMatchObject({ application_id: applicationId, job_id: jobId })
    expect((await repo.findApplicationForRecruiter(owner, applicant, applicationId))?.job_title).toMatch(/^Placeholder Chief Officer/)
    // Someone else's job, the wrong applicant, or a withdrawn application do not count.
    expect(await repo.findApplicationForRecruiter(outsider, applicant, applicationId)).toBeNull()
    expect(await repo.findApplicationForRecruiter(colleague, otherApplicant, applicationId)).toBeNull()
    expect(await repo.findApplicationForRecruiter(colleague, otherApplicant, withdrawnId)).toBeNull()
    // A deleted job does not count.
    await db.query(`update public.jobs set deleted_at = now() where id = $1`, [jobId])
    expect(await repo.findApplicationForRecruiter(colleague, applicant, applicationId)).toBeNull()
  })

  it('a personal job counts only while its poster holds a recruiter verification', async () => {
    const poster = await profile('Placeholder Personal Poster')
    const applicant = await profile('Placeholder Personal Applicant')
    await db.query(`insert into public.feature_verifications (profile_id, verification_type, status) values ($1, 'recruiter', 'approved')`, [poster])
    const [job] = await db.query(
      `insert into public.jobs (title, company_name, summary, description, created_by_user_id, status) values ('Placeholder Personal Job', 'Placeholder', 'Placeholder summary.', 'Placeholder description.', $1, 'published') returning id`,
      [poster],
    )
    const applicationId = await apply(String(job!.id), applicant)

    const repo = recruiters()
    expect(await repo.findApplicationForRecruiter(poster, applicant, applicationId)).toMatchObject({ application_id: applicationId })
    await db.query(`update public.feature_verifications set status = 'suspended' where profile_id = $1`, [poster])
    expect(await repo.findApplicationForRecruiter(poster, applicant, applicationId)).toBeNull()
  })
})

describe('open to recruiters, the daily count and the reason row', () => {
  it('reads open_to_recruiters, records the reason with the job title, and counts the last 24 hours', async () => {
    const recruiter = await profile('Placeholder Counting Recruiter')
    const owner = await profile('Placeholder Counting Owner')
    const org = await company(owner, true)
    await member(org, owner, 'owner')
    const open = await profile('Placeholder Open Member')
    const closed = await profile('Placeholder Closed Member')
    await db.query(`insert into public.member_preferences (profile_id, open_to_recruiters) values ($1, true), ($2, false)`, [open, closed])

    const repo = recruiters()
    expect(await repo.isOpenToRecruiters(open)).toBe(true)
    expect(await repo.isOpenToRecruiters(closed)).toBe(false)
    expect(await repo.isOpenToRecruiters(await profile('Placeholder No Preferences'))).toBe(false)

    const messaging = createMessagingRepository({ query })
    const hiring = createHiringRepository({ query, transaction })
    const jobId = await hiring.createJob(owner, jobInput({ companyId: org }))
    const applicationId = await apply(jobId, closed)
    const first = await messaging.insertDirectConversation(recruiter, open)
    const second = await messaging.insertDirectConversation(recruiter, closed)
    await repo.insert({ conversationId: first, recruiterId: recruiter, memberId: open, reason: 'open_to_recruiters', applicationId: null, jobId: null })
    await repo.insert({ conversationId: second, recruiterId: recruiter, memberId: closed, reason: 'applied', applicationId, jobId })
    // Inserting the same conversation again changes nothing.
    await repo.insert({ conversationId: second, recruiterId: recruiter, memberId: closed, reason: 'open_to_recruiters', applicationId: null, jobId: null })

    expect(await repo.findByConversation(second)).toMatchObject({ recruiter_profile_id: recruiter, member_profile_id: closed, reason: 'applied', job_application_id: applicationId })
    expect((await repo.findByConversation(second))?.job_title).toMatch(/^Placeholder Chief Officer/)
    expect(await repo.findByConversation(first)).toMatchObject({ reason: 'open_to_recruiters', job_title: null })

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    expect(await repo.countSince(recruiter, dayAgo)).toBe(2)
    await db.query(`update public.recruiter_conversations set created_at = now() - interval '25 hours' where conversation_id = $1`, [first])
    expect(await repo.countSince(recruiter, dayAgo)).toBe(1)
    await db.transaction(async (tx) => {
      await createRecruiterContactRepository({ query: tx }).lockRecruiter(recruiter)
    })
  })
})
