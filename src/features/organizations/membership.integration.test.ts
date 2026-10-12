import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAccessRepository } from '@/features/access/repository'
import { canUseCapability } from '@/features/access/policy'
import { createOrganizationMembershipRepository } from './membership-repository'
import { createOrganizationRepository } from './repository'
import { createNotificationRepository } from '@/features/notifications/repository'
import { createNotificationQueries } from '@/features/notifications/queries'

/**
 * Round F (F2) against the real schema (PGlite, every migration): any approved member can leave an
 * organization, the last owner cannot until they hand it to an administrator, access ends at once,
 * the audit row and the managers' notice are written, and the member can ask to join again.
 * Placeholder data only.
 */

let db: TestDatabase
let membership: ReturnType<typeof createOrganizationMembershipRepository>
let organizations: ReturnType<typeof createOrganizationRepository>
let access: ReturnType<typeof createAccessRepository>

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
  const transaction = <T,>(work: (client: { query: <R extends QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<{ rows: R[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async <R extends QueryResultRow>(text: string, values?: readonly unknown[]) => ({ rows: await query(text, values) as R[] }) }))
  membership = createOrganizationMembershipRepository({ transaction: transaction as never })
  organizations = createOrganizationRepository({ query: (text, values) => db.query(text, values), transaction: db.transaction })
  access = createAccessRepository({ query: (text, values) => db.query(text, values) })
}, 120_000)

afterAll(async () => {
  await db?.close()
})

let sequence = 0

async function person(name: string) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at)
     values (gen_random_uuid(), $1, $2, now()) returning id`,
    [name, `fixture-person-${sequence}`],
  )
  return rows[0]!.id as string
}

async function organization(roles: Array<[string, string]>) {
  sequence += 1
  const rows = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified) values ($1, $2, $3, true) returning id`,
    [`fixture-organization-${sequence}`, `Fixture Organization ${sequence}`, roles[0]![0]],
  )
  const companyId = rows[0]!.id as string
  for (const [userId, role] of roles) {
    await db.query(
      `insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, $3::public.company_member_role, now())`,
      [companyId, userId, role],
    )
  }
  return companyId
}

async function memberRole(companyId: string, userId: string) {
  const rows = await db.query(`select role::text as role from public.company_members where company_id = $1 and user_id = $2`, [companyId, userId])
  return (rows[0]?.role as string | undefined) ?? null
}

describe('leaving an organization (round F, F2)', () => {
  it('lets a plain member leave: the membership, role and workspace access end at once', async () => {
    const owner = await person('Fixture Owner')
    const admin = await person('Fixture Admin')
    const plain = await person('Fixture Member')
    const companyId = await organization([[owner, 'owner'], [admin, 'administrator'], [plain, 'member']])
    await db.query(`insert into public.maritime_profiles (user_id, current_company_id, current_company) values ($1, $2, 'Fixture Organization')`, [plain, companyId])

    const before = await access.getAccessContext(plain)
    expect(before.organizationMemberships.map((entry) => entry.companyId)).toContain(companyId)

    const state = await membership.getLeaveState(plain, companyId)
    expect(state).toMatchObject({ companyId, role: 'member', lastOwner: false, administrators: [] })

    const left = await membership.leave(plain, companyId)
    expect(left).toMatchObject({ companyId, previousRole: 'member', notified: 2 })

    expect(await memberRole(companyId, plain)).toBeNull()
    const after = await access.getAccessContext(plain)
    expect(after.organizationMemberships.map((entry) => entry.companyId)).not.toContain(companyId)
    expect(canUseCapability(after, 'organization.manage', { companyId })).toBe(false)
    expect(canUseCapability(after, 'job.publish', { companyId })).toBe(false)
    expect(await membership.getLeaveState(plain, companyId)).toBeNull()

    const profile = await db.query(`select current_company_id, current_company from public.maritime_profiles where user_id = $1`, [plain])
    expect(profile[0]).toMatchObject({ current_company_id: null, current_company: null })
  })

  it('writes an audit row with who, which organization and the previous role, and nothing personal', async () => {
    const owner = await person('Fixture Owner')
    const recruiter = await person('Fixture Recruiter')
    const companyId = await organization([[owner, 'owner'], [recruiter, 'recruiter']])

    await membership.leave(recruiter, companyId)

    const audit = await db.query(
      `select actor_id, action, target_type, target_id, metadata from public.audit_events where action = 'organization.member_left' and target_id = $1`,
      [companyId],
    )
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor_id: recruiter, target_type: 'company', target_id: companyId, metadata: { previousRole: 'recruiter' } })
    expect(Object.keys(audit[0]!.metadata as object)).toEqual(['previousRole'])
  })

  it('tells the remaining owners and administrators in-app, and nobody else', async () => {
    const owner = await person('Fixture Owner')
    const admin = await person('Fixture Admin')
    const colleague = await person('Fixture Colleague')
    const leaver = await person('Fixture Leaver')
    const companyId = await organization([[owner, 'owner'], [admin, 'administrator'], [colleague, 'member'], [leaver, 'lms_manager']])

    await membership.leave(leaver, companyId)

    const notices = await db.query(
      `select recipient_id, actor_id, company_id from public.notifications where notification_type = 'organization_member_left' and company_id = $1 order by recipient_id`,
      [companyId],
    )
    expect(notices.map((row) => row.recipient_id).sort()).toEqual([owner, admin].sort())
    expect(notices.every((row) => row.actor_id === leaver)).toBe(true)

    const ownerView = createNotificationQueries({
      requireUser: async () => ({ id: owner }),
      repository: createNotificationRepository({ query: (text, values) => db.query(text, values) }),
      getProfiles: async () => [],
      resolveMediaUrls: async () => new Map(),
    })
    const [notice] = await ownerView.getNotifications()
    expect(notice).toMatchObject({ type: 'organization_member_left', destination: expect.stringMatching(/^\/organizations\/fixture-organization-\d+\/manage$/) })
    expect(notice!.message).toMatch(/left Fixture Organization \d+/)
  })

  it('withdraws the member\'s pending requests for that organization and ends a recruiter verification that came only from it', async () => {
    const owner = await person('Fixture Owner')
    const leaver = await person('Fixture Recruiter')
    const companyId = await organization([[owner, 'owner'], [leaver, 'recruiter']])
    await db.query(
      `insert into public.company_access_requests (company_id, user_id, requested_role, request_type, status, requested_at)
       values ($1, $2, 'administrator', 'recruiter_access', 'pending', now())`,
      [companyId, leaver],
    )
    await db.query(
      `insert into public.feature_verifications (profile_id, verification_type, status, source) values ($1, 'recruiter', 'approved', 'company_membership')`,
      [leaver],
    )

    await membership.leave(leaver, companyId)

    const requests = await db.query(`select status from public.company_access_requests where company_id = $1 and user_id = $2`, [companyId, leaver])
    expect(requests.map((row) => row.status)).toEqual(['cancelled'])
    const verification = await db.query(`select status from public.feature_verifications where profile_id = $1 and verification_type = 'recruiter'`, [leaver])
    expect(verification[0]!.status).toBe('suspended')
  })

  it('keeps a recruiter verification when another verified organization still grants it', async () => {
    const owner = await person('Fixture Owner')
    const leaver = await person('Fixture Recruiter')
    const first = await organization([[owner, 'owner'], [leaver, 'recruiter']])
    await organization([[owner, 'owner'], [leaver, 'recruiter']])
    await db.query(
      `insert into public.feature_verifications (profile_id, verification_type, status, source) values ($1, 'recruiter', 'approved', 'company_membership')`,
      [leaver],
    )

    await membership.leave(leaver, first)

    const verification = await db.query(`select status from public.feature_verifications where profile_id = $1 and verification_type = 'recruiter'`, [leaver])
    expect(verification[0]!.status).toBe('approved')
  })

  it('blocks the last owner, and leaves everything as it was', async () => {
    const owner = await person('Fixture Owner')
    const admin = await person('Fixture Admin')
    const companyId = await organization([[owner, 'owner'], [admin, 'administrator']])

    const state = await membership.getLeaveState(owner, companyId)
    expect(state).toMatchObject({ role: 'owner', lastOwner: true, administrators: [{ profileId: admin, fullName: 'Fixture Admin' }] })

    await expect(membership.leave(owner, companyId)).rejects.toThrow('organization_last_owner')
    expect(await memberRole(companyId, owner)).toBe('owner')
    const audit = await db.query(`select 1 from public.audit_events where action = 'organization.member_left' and target_id = $1`, [companyId])
    expect(audit).toHaveLength(0)
  })

  it('lets an owner leave when another owner remains', async () => {
    const first = await person('Fixture Owner')
    const second = await person('Fixture Co-owner')
    const companyId = await organization([[first, 'owner'], [second, 'owner']])

    expect((await membership.getLeaveState(first, companyId))?.lastOwner).toBe(false)
    await membership.leave(first, companyId)
    expect(await memberRole(companyId, first)).toBeNull()
    expect(await memberRole(companyId, second)).toBe('owner')
  })

  it('refuses someone who is not an approved member', async () => {
    const owner = await person('Fixture Owner')
    const stranger = await person('Fixture Stranger')
    const companyId = await organization([[owner, 'owner']])
    await expect(membership.leave(stranger, companyId)).rejects.toThrow('organization_member_not_found')
    expect(await membership.getLeaveState(stranger, companyId)).toBeNull()
  })

  it('lets a member who left ask to join again', async () => {
    const owner = await person('Fixture Owner')
    const leaver = await person('Fixture Member')
    const companyId = await organization([[owner, 'owner'], [leaver, 'member']])

    await expect(organizations.requestCompanyAccess(leaver, companyId, 'member', null)).rejects.toThrow('organization_membership_exists')
    await membership.leave(leaver, companyId)
    const request = await organizations.requestCompanyAccess(leaver, companyId, 'member', null)
    expect(request.requestId).toEqual(expect.any(String))
  })
})

describe('transferring ownership (round F, F2)', () => {
  it('hands the organization to an administrator; the old owner becomes an administrator and can then leave', async () => {
    const owner = await person('Fixture Owner')
    const admin = await person('Fixture Admin')
    const companyId = await organization([[owner, 'owner'], [admin, 'administrator']])

    await membership.transferOwnership(owner, companyId, admin)
    expect(await memberRole(companyId, admin)).toBe('owner')
    expect(await memberRole(companyId, owner)).toBe('administrator')
    const audit = await db.query(
      `select actor_id, metadata from public.audit_events where action = 'organization.ownership_transferred' and target_id = $1`,
      [companyId],
    )
    expect(audit[0]).toMatchObject({ actor_id: owner, metadata: { newOwnerId: admin } })

    expect((await membership.getLeaveState(owner, companyId))?.lastOwner).toBe(false)
    await membership.leave(owner, companyId)
    expect(await memberRole(companyId, owner)).toBeNull()
  })

  it('only hands it to a current administrator, and only an owner can do it', async () => {
    const owner = await person('Fixture Owner')
    const admin = await person('Fixture Admin')
    const plain = await person('Fixture Member')
    const outsider = await person('Fixture Outsider')
    const companyId = await organization([[owner, 'owner'], [admin, 'administrator'], [plain, 'member']])

    await expect(membership.transferOwnership(owner, companyId, plain)).rejects.toThrow('organization_transfer_target_invalid')
    await expect(membership.transferOwnership(owner, companyId, outsider)).rejects.toThrow('organization_transfer_target_invalid')
    await expect(membership.transferOwnership(admin, companyId, plain)).rejects.toThrow('organization_transfer_forbidden')
    await expect(membership.transferOwnership(owner, companyId, owner)).rejects.toThrow('organization_transfer_invalid')
    expect(await memberRole(companyId, owner)).toBe('owner')
    expect(await memberRole(companyId, plain)).toBe('member')
  })
})
