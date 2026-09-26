import { describe, expect, it } from 'vitest'
import { createAdminMembershipRepository } from './membership-repository'
import type { AccessContext } from '@/features/access/policy'

const adminId = '11111111-1111-4111-8111-111111111111'
const profileId = '22222222-2222-4222-8222-222222222222'
const companyId = '33333333-3333-4333-8333-333333333333'
const grantId = '44444444-4444-4444-8444-444444444444'

function access(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    personalPlan: 'creator_pro',
    personalEntitlements: ['job.apply', 'event.attend', 'course.enroll', 'job.publish'],
    verifications: ['recruiter'],
    organizationMemberships: [],
    accountActive: true,
    ...overrides,
  }
}

describe('admin membership repository', () => {
  it('shows persona, plan, effective capabilities, verification source/status and entitlement history for a user', async () => {
    const query = async (text: string) => {
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.profiles profile')) {
        return [{
          profile_id: profileId,
          persona: 'recruiter_hr',
          profile_intents: ['hire', 'network'],
          account_status: 'active',
        }]
      }
      if (text.includes('from public.account_subscriptions subscription') && text.includes('profile_id')) {
        return [{
          id: 'subscription-1',
          plan_code: 'creator_pro',
          status: 'active',
          billing_provider: 'future-provider',
          current_period_started_at: '2026-09-01T00:00:00.000Z',
          current_period_ends_at: '2026-10-01T00:00:00.000Z',
          cancel_at_period_end: false,
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        }]
      }
      if (text.includes('from public.feature_verifications verification')) {
        return [
          {
            verification_type: 'recruiter',
            status: 'approved',
            source: 'application',
            submitted_at: '2026-09-20T00:00:00.000Z',
            reviewed_at: '2026-09-21T00:00:00.000Z',
            review_note: null,
          },
          {
            verification_type: 'event_host',
            status: 'pending',
            source: 'application',
            submitted_at: '2026-09-24T00:00:00.000Z',
            reviewed_at: null,
            review_note: null,
          },
        ]
      }
      if (text.includes('from public.entitlement_grants grant_record') && text.includes('profile_id')) {
        return [{
          id: grantId,
          capability: 'job.publish',
          source: 'legacy_migration',
          reason: 'Grandfathered recruiter access',
          expires_at: null,
          revoked_at: null,
          created_at: '2026-09-20T00:00:00.000Z',
          granted_by: null,
          granted_by_name: null,
        }]
      }
      if (text.includes('from public.audit_events audit') && text.includes('feature_verification')) {
        return [{
          id: 'audit-1',
          action: 'verification.approved',
          target_id: 'verification-1',
          metadata: { verificationType: 'recruiter' },
          created_at: '2026-09-21T00:00:00.000Z',
          actor_id: adminId,
          actor_name: 'Platform Admin',
        }]
      }
      return []
    }
    const repository = createAdminMembershipRepository({
      query,
      loadAccessContext: async () => access(),
    })

    await expect(repository.getUserAccessOverview(adminId, profileId)).resolves.toEqual({
      profileId,
      persona: 'recruiter_hr',
      intents: ['hire', 'network'],
      accountStatus: 'active',
      plan: 'creator_pro',
      subscription: expect.objectContaining({
        id: 'subscription-1',
        plan: 'creator_pro',
        status: 'active',
      }),
      effectiveCapabilities: ['job.apply', 'event.attend', 'course.enroll', 'job.publish'],
      verifications: [
        expect.objectContaining({ type: 'recruiter', status: 'approved', source: 'application' }),
        expect.objectContaining({ type: 'event_host', status: 'pending', source: 'application' }),
      ],
      entitlementHistory: [
        expect.objectContaining({
          id: grantId,
          capability: 'job.publish',
          source: 'legacy_migration',
          active: true,
        }),
      ],
      verificationHistory: [
        expect.objectContaining({
          id: 'audit-1',
          action: 'verification.approved',
          verificationType: 'recruiter',
          actor: { id: adminId, fullName: 'Platform Admin' },
        }),
      ],
    })
  })

  it('joins verification audit history without comparing uuid directly to text target ids', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.profiles profile')) {
        return [{
          profile_id: profileId,
          persona: 'recruiter_hr',
          profile_intents: ['hire'],
          account_status: 'active',
        }]
      }
      return []
    }
    const repository = createAdminMembershipRepository({
      query,
      loadAccessContext: async () => access(),
    })

    await repository.getUserAccessOverview(adminId, profileId)

    const auditQuery = seen.find((entry) => entry.text.includes('from public.audit_events audit'))
    expect(auditQuery?.text).toContain('verification.id::text = audit.target_id')
    expect(auditQuery?.text).not.toContain('verification.id = audit.target_id')
  })

  it('shows no effective capability when the account is suspended even if a paid plan and grant exist', async () => {
    const query = async (text: string) => {
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.profiles profile')) {
        return [{ profile_id: profileId, persona: 'recruiter_hr', profile_intents: ['hire'], account_status: 'suspended' }]
      }
      return []
    }
    const repository = createAdminMembershipRepository({
      query,
      loadAccessContext: async () => access({ accountActive: false }),
    })

    const overview = await repository.getUserAccessOverview(adminId, profileId)
    expect(overview?.effectiveCapabilities).toEqual([])
  })

  it('shows organization plan, approved managers and entitlement history', async () => {
    const query = async (text: string) => {
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.companies company') && text.includes('limit 1')) {
        return [{
          company_id: companyId,
          company_name: 'Sea Academy',
          company_verified: true,
        }]
      }
      if (text.includes('from public.account_subscriptions subscription') && text.includes('company_id')) {
        return [{
          id: 'subscription-org',
          plan_code: 'organization_pro',
          status: 'active',
          billing_provider: null,
          current_period_started_at: null,
          current_period_ends_at: null,
          cancel_at_period_end: false,
          created_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-01T00:00:00.000Z',
        }]
      }
      if (text.includes('from public.company_members member')) {
        return [
          {
            profile_id: '55555555-5555-4555-8555-555555555555',
            full_name: 'Owner One',
            slug: 'owner-one',
            role: 'owner',
            approved_at: '2026-09-01T00:00:00.000Z',
          },
          {
            profile_id: '66666666-6666-4666-8666-666666666666',
            full_name: 'LMS Manager',
            slug: 'lms-manager',
            role: 'lms_manager',
            approved_at: '2026-09-02T00:00:00.000Z',
          },
        ]
      }
      if (text.includes('from public.entitlement_grants grant_record') && text.includes('company_id')) {
        return [{
          id: grantId,
          capability: 'course.publish',
          source: 'legacy_migration',
          reason: 'Preserve existing organization course access',
          expires_at: null,
          revoked_at: null,
          created_at: '2026-09-01T00:00:00.000Z',
          granted_by: null,
          granted_by_name: null,
        }]
      }
      return []
    }
    const repository = createAdminMembershipRepository({ query })

    await expect(repository.getOrganizationAccessOverview(adminId, companyId)).resolves.toEqual({
      companyId,
      name: 'Sea Academy',
      verified: true,
      plan: 'organization_pro',
      subscription: expect.objectContaining({ id: 'subscription-org', status: 'active' }),
      managers: [
        expect.objectContaining({ fullName: 'Owner One', role: 'owner' }),
        expect.objectContaining({ fullName: 'LMS Manager', role: 'lms_manager' }),
      ],
      entitlementHistory: [
        expect.objectContaining({ capability: 'course.publish', active: true }),
      ],
    })
  })

  it('grants only narrowly allowed personal creator capabilities and writes an audit event', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('insert into public.entitlement_grants')) return [{ id: grantId }]
      return []
    }
    const repository = createAdminMembershipRepository({
      query,
      transaction: async (work) => work(query),
    })

    await expect(repository.grantEntitlement(adminId, {
      subjectType: 'profile',
      subjectId: profileId,
      capability: 'job.publish',
      reason: 'Temporary approved migration support',
    })).resolves.toEqual({ grantId })

    const grant = seen.find((entry) => entry.text.includes('insert into public.entitlement_grants'))
    expect(grant?.text).toContain("'admin'")
    expect(grant?.values).toContain('job.publish')
    expect(seen.some((entry) => entry.text.includes('insert into public.audit_events') && entry.values?.includes('entitlement.granted'))).toBe(true)

    await expect(repository.grantEntitlement(adminId, {
      subjectType: 'profile',
      subjectId: profileId,
      capability: 'billing.manage',
      reason: 'Should not be permitted',
    })).rejects.toThrow('admin_entitlement_capability_forbidden')
  })

  it('supports safe organization operational grants and audited revocation', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('insert into public.entitlement_grants')) return [{ id: grantId }]
      if (text.includes('update public.entitlement_grants') && text.includes('revoked_at')) {
        return [{ id: grantId, capability: 'course.publish', profile_id: null, company_id: companyId }]
      }
      return []
    }
    const repository = createAdminMembershipRepository({
      query,
      transaction: async (work) => work(query),
    })

    await expect(repository.grantEntitlement(adminId, {
      subjectType: 'company',
      subjectId: companyId,
      capability: 'course.publish',
      reason: 'Approved transition support',
    })).resolves.toEqual({ grantId })

    await expect(repository.revokeEntitlement(adminId, grantId, 'Transition complete')).resolves.toBe(true)
    expect(seen.some((entry) => entry.text.includes('insert into public.audit_events') && entry.values?.includes('entitlement.revoked'))).toBe(true)
  })
})
