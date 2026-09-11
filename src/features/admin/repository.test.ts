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
        return [{ pending_organizations: '5', changes_requested: '2', approved_organizations: '19', suspended_organizations: '1', pending_access_requests: '7' }]
      },
    })

    await expect(repository.getAdminDashboardMetrics(adminId)).resolves.toEqual({
      pendingOrganizations: 5,
      changesRequested: 2,
      approvedOrganizations: 19,
      suspendedOrganizations: 1,
      pendingAccessRequests: 7,
    })
    expect(seen[1]?.text).toContain('public.organization_applications')
    expect(seen[1]?.text).toContain('public.company_access_requests')
  })

  it('lists organization applications oldest-first with applicant and employer context', async () => {
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
