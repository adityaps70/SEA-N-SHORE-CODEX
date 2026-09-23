import { describe, expect, it } from 'vitest'
import { createAdminRepository } from './repository'

const adminId = '11111111-1111-4111-8111-111111111111'
const applicationId = '22222222-2222-4222-8222-222222222222'

const reviewRow = {
  application_id: applicationId,
  company_id: '33333333-3333-4333-8333-333333333333',
  submitted_by: '44444444-4444-4444-8444-444444444444',
  application_status: 'pending',
  official_email: 'hiring@oceanic.example.com',
  registration_reference: 'CIN-12345',
  applicant_role: 'Managing Director',
  supporting_notes: 'Verify for maritime hiring.',
  submitted_at: '2026-09-11T10:00:00.000Z',
  updated_at: '2026-09-11T10:00:00.000Z',
  reviewed_at: null,
  admin_review_note: null,
  company_slug: 'oceanic-shipping',
  company_name: 'Oceanic Shipping',
  company_type: 'Ship Management Company',
  website: 'https://oceanic.example.com',
  company_description: 'Ship management and crewing company.',
  fleet_summary: '12 managed vessels.',
  vessel_types: ['Oil Tanker'],
  office_locations: ['Mumbai, India'],
  company_verified: false,
  applicant_name: 'Asha Singh',
  applicant_slug: 'asha-singh',
  applicant_headline: 'Managing Director',
  membership_role: 'owner',
  membership_approved_at: null,
}

describe('platform admin organization repository', () => {
  it('authorizes platform admins only through public.user_roles administrator role', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{ allowed: true }]
      },
    })

    await expect(repository.isPlatformAdministrator(adminId)).resolves.toBe(true)
    expect(seen[0]?.text).toContain('public.user_roles')
    expect(seen[0]?.text).toContain("role::text = 'administrator'")
    expect(seen[0]?.text).not.toContain('profile_type')
    expect(seen[0]?.values).toEqual([adminId])
  })

  it('fails closed before loading admin dashboard data for a non-admin', async () => {
    const seen: string[] = []
    const repository = createAdminRepository({
      query: async (text) => {
        seen.push(text)
        return [{ allowed: false }]
      },
    })

    await expect(repository.getAdminDashboardMetrics('not-admin')).rejects.toThrow('admin_forbidden')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('public.user_roles')
  })

  it('loads organization and access-request queue metrics only after admin authorization', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles')) return [{ allowed: true }]
        return [{
          pending_organizations: '5',
          changes_requested: '2',
          approved_organizations: '19',
          suspended_organizations: '1',
          pending_access_requests: '7',
          open_reports: '11',
          reviewing_reports: '3',
          high_priority_reports: '4',
          reports_last_24h: '6',
          active_posts: '920',
          published_jobs: '48',
          published_events: '12',
        }]
      },
    })

    await expect(repository.getAdminDashboardMetrics(adminId)).resolves.toEqual({
      pendingOrganizations: 5,
      changesRequested: 2,
      approvedOrganizations: 19,
      suspendedOrganizations: 1,
      pendingAccessRequests: 7,
      openReports: 11,
      reviewingReports: 3,
      highPriorityReports: 4,
      reportsLast24h: 6,
      activePosts: 920,
      publishedJobs: 48,
      publishedEvents: 12,
    })
    expect(seen[1]?.text).toContain('public.organization_applications')
    expect(seen[1]?.text).toContain('public.company_access_requests')
    expect(seen[1]?.text).toContain('public.content_reports')
    expect(seen[1]?.text).toContain('public.posts')
    expect(seen[1]?.text).toContain('public.jobs')
    expect(seen[1]?.text).toContain('public.events')
  })

  it('lists a bounded organization queue oldest-first with applicant and employer context', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles')) return [{ allowed: true }]
        return [reviewRow]
      },
    })

    const rows = await repository.listOrganizationApplications(adminId, 'pending')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      applicationId,
      status: 'pending',
      company: { id: reviewRow.company_id, name: 'Oceanic Shipping', verified: false },
      applicant: { id: reviewRow.submitted_by, fullName: 'Asha Singh' },
    })
    expect(seen[1]?.text).toContain('oa.status = $1')
    expect(seen[1]?.text).toContain('order by oa.submitted_at asc')
    expect(seen[1]?.text).toContain('limit 100')
    expect(seen[1]?.values).toEqual(['pending'])
  })

  it('loads a full organization review only for a platform administrator', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles')) return [{ allowed: true }]
        return [reviewRow]
      },
    })

    await expect(repository.getOrganizationApplicationReview(adminId, applicationId)).resolves.toMatchObject({
      applicationId,
      officialEmail: 'hiring@oceanic.example.com',
      applicantRole: 'Managing Director',
      company: { name: 'Oceanic Shipping', vesselTypes: ['Oil Tanker'], officeLocations: ['Mumbai, India'] },
      applicant: { fullName: 'Asha Singh', membershipRole: 'owner', membershipApprovedAt: null },
    })
    expect(seen[1]?.text).toContain('oa.id = $1')
    expect(seen[1]?.values).toEqual([applicationId])
  })

  it('approves company and founding owner, updates application and writes audit in one transaction', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    let transactionCount = 0
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update')) return [{
        id: applicationId,
        company_id: reviewRow.company_id,
        submitted_by: reviewRow.submitted_by,
        status: 'pending',
      }]
      return []
    }
    const repository = createAdminRepository({
      query,
      transaction: async (work) => {
        transactionCount += 1
        return work(query)
      },
    })

    await expect(repository.reviewOrganizationApplication(adminId, applicationId, 'approved', 'Verified company records.')).resolves.toBe(true)

    expect(transactionCount).toBe(1)
    expect(seen[0]?.text).toContain('public.user_roles ur')
    expect(seen[0]?.text).toContain("ur.role::text = 'administrator'")
    expect(seen[0]?.text).toContain('for update')
    expect(seen[0]?.text).not.toContain('profile_type')
    expect(seen.some((entry) => entry.text.includes('update public.companies') && entry.text.includes('is_verified = true'))).toBe(true)
    expect(seen.some((entry) => entry.text.includes('update public.company_members') && entry.text.includes('approved_at = coalesce'))).toBe(true)
    expect(seen.some((entry) => entry.text.includes('update public.organization_applications') && entry.values?.includes('approved'))).toBe(true)
    const audit = seen.find((entry) => entry.text.includes('insert into public.audit_events'))
    expect(audit?.values).toContain('organization.approved')
    expect(audit?.values).toContain(applicationId)
  })

  it('records requested changes without verifying the company', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update')) return [{ id: applicationId, company_id: reviewRow.company_id, submitted_by: reviewRow.submitted_by, status: 'pending' }]
      return []
    }
    const repository = createAdminRepository({ query, transaction: async (work) => work(query) })

    await repository.reviewOrganizationApplication(adminId, applicationId, 'changes_requested', 'Use your official company email.')

    expect(seen.some((entry) => entry.text.includes('is_verified = true'))).toBe(false)
    expect(seen.some((entry) => entry.text.includes('update public.organization_applications') && entry.values?.includes('changes_requested'))).toBe(true)
    expect(seen.find((entry) => entry.text.includes('insert into public.audit_events'))?.values).toContain('organization.changes_requested')
  })

  it('suspends an approved company immediately and writes an audit event', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update')) return [{ id: applicationId, company_id: reviewRow.company_id, submitted_by: reviewRow.submitted_by, status: 'approved' }]
      return []
    }
    const repository = createAdminRepository({ query, transaction: async (work) => work(query) })

    await repository.reviewOrganizationApplication(adminId, applicationId, 'suspended', 'Verification concern under review.')

    expect(seen.some((entry) => entry.text.includes('update public.companies') && entry.text.includes('is_verified = false'))).toBe(true)
    expect(seen.some((entry) => entry.text.includes('update public.organization_applications') && entry.values?.includes('suspended'))).toBe(true)
    expect(seen.find((entry) => entry.text.includes('insert into public.audit_events'))?.values).toContain('organization.suspended')
  })
})

describe('platform admin user controls', () => {
  const targetId = '55555555-5555-4555-8555-555555555555'
  const userRow = {
    profile_id: targetId,
    full_name: 'Capt. Member',
    slug: 'capt-member',
    headline: 'Master Mariner',
    account_status: 'active',
    email: 'member@example.com',
    provider_subject: 'cognito-sub-member',
    is_administrator: false,
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-09-20T10:00:00.000Z',
  }

  it('searches users by name, username or email with account status context', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles ur') && text.includes("role::text = 'administrator'") && !text.includes('is_administrator')) {
          return [{ allowed: true }]
        }
        return [userRow]
      },
    })

    const users = await repository.searchUsers(adminId, { query: 'member@example.com', status: 'all', limit: 30 })

    expect(users).toEqual([expect.objectContaining({
      id: targetId,
      fullName: 'Capt. Member',
      slug: 'capt-member',
      email: 'member@example.com',
      status: 'active',
      isAdministrator: false,
    })])
    expect(seen[1]?.text).toContain('public.identity_accounts')
    expect(seen[1]?.text).toContain('lower(coalesce(ia.email')
    expect(seen[1]?.values).toContain('%member@example.com%')
  })

  it('binds the default admin user list limit instead of sending an unused query parameter', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('public.user_roles ur')) return [{ allowed: true }]
        return []
      },
    })

    await expect(repository.searchUsers(adminId, { query: '', status: 'all', limit: 100 })).resolves.toEqual([])

    expect(seen[1]?.text).toContain('limit $1')
    expect(seen[1]?.values).toEqual([100])
  })

  it('suspends and restores a normal user transactionally and records the reason in audit history', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    let status = 'active'
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('public.user_roles ur') && text.includes("role::text = 'administrator'") && !text.includes('target_admin')) {
        return [{ allowed: true }]
      }
      if (text.includes('from public.profiles p') && text.includes('for update')) {
        return [{ ...userRow, account_status: status }]
      }
      if (text.includes('update public.profiles')) {
        status = String(values?.[1] ?? status)
      }
      return []
    }
    const repository = createAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.setUserAccountStatus(adminId, targetId, 'suspended', 'Repeated unsafe recruitment messages.')).resolves.toBe(true)
    expect(status).toBe('suspended')
    let audit = seen.find((entry) => entry.text.includes('insert into public.audit_events') && entry.values?.includes('account.suspended'))
    expect(audit?.values).toContain(targetId)
    expect(String(audit?.values?.at(-1))).toContain('Repeated unsafe recruitment messages.')

    seen.length = 0
    await expect(repository.setUserAccountStatus(adminId, targetId, 'active', 'Appeal reviewed and access restored.')).resolves.toBe(true)
    expect(status).toBe('active')
    audit = seen.find((entry) => entry.text.includes('insert into public.audit_events') && entry.values?.includes('account.restored'))
    expect(String(audit?.values?.at(-1))).toContain('Appeal reviewed and access restored.')
  })

  it('does not let an administrator suspend themselves or another administrator', async () => {
    const selfRepository = createAdminRepository({
      query: async (text) => text.includes('public.user_roles ur') ? [{ allowed: true }] : [],
      transaction: async (work) => work(async (text) => text.includes('public.user_roles ur') ? [{ allowed: true }] : []),
    })
    await expect(selfRepository.setUserAccountStatus(adminId, adminId, 'suspended', 'No.')).rejects.toThrow('admin_user_self_action_forbidden')

    const query = async (text: string) => {
      if (text.includes('public.user_roles ur') && text.includes("role::text = 'administrator'") && !text.includes('target_admin')) return [{ allowed: true }]
      if (text.includes('from public.profiles p') && text.includes('for update')) return [{ ...userRow, is_administrator: true }]
      return []
    }
    const repository = createAdminRepository({ query, transaction: async (work) => work(query) })
    await expect(repository.setUserAccountStatus(adminId, targetId, 'suspended', 'No.')).rejects.toThrow('admin_user_target_administrator_forbidden')
  })

  it('loads user-specific moderation history including reasons', async () => {
    const repository = createAdminRepository({
      query: async (text) => {
        if (text.includes('public.user_roles')) return [{ allowed: true }]
        return [{
          id: '99',
          actor_id: adminId,
          actor_name: 'Platform Admin',
          actor_slug: 'platform-admin',
          action: 'account.suspended',
          target_type: 'user_account',
          target_id: targetId,
          metadata: { reason: 'Safety review', previousStatus: 'active', nextStatus: 'suspended' },
          created_at: '2026-09-22T10:00:00.000Z',
        }]
      },
    })

    const history = await repository.listUserAccountHistory(adminId, targetId, 50)
    expect(history[0]).toMatchObject({
      action: 'account.suspended',
      targetId,
      metadata: { reason: 'Safety review' },
    })
  })
})
