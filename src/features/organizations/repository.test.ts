import { describe, expect, it } from 'vitest'
import { createOrganizationRepository, type OrganizationApplicationInput } from './repository'
import { organizationApplicationSchema } from './schemas'

const actorId = '11111111-1111-4111-8111-111111111111'

function applicationInput(overrides: Partial<OrganizationApplicationInput> = {}) {
  return organizationApplicationSchema.parse(rawApplicationInput(overrides))
}

function rawApplicationInput(overrides: Partial<OrganizationApplicationInput> = {}): OrganizationApplicationInput {
  return {
    organizationName: 'Oceanic Shipping Pvt Ltd',
    organizationType: 'ship_manager',
    fleetSize: 12,
    website: 'https://oceanic.example.com',
    officialEmail: 'hiring@oceanic.example.com',
    officeLocation: 'Mumbai, India',
    description: 'Ship management and crewing company serving international owners.',
    fleetSummary: '12 managed tankers and bulk carriers.',
    vesselTypes: ['Oil Tanker', 'Bulk Carrier'],
    applicantRole: 'Managing Director',
    registrationReference: 'CIN-12345',
    supportingNotes: 'Please verify our company profile for maritime hiring.',
    ...overrides,
  }
}

describe('organization approval repository', () => {
  it('creates company, unapproved owner membership and pending application in one transaction', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('insert into public.companies')) return [{ id: 'company-1', slug: 'oceanic-shipping-pvt-ltd-11111111' }]
      if (text.includes('insert into public.organization_applications')) return [{ id: 'application-1' }]
      return []
    }
    let transactionCount = 0
    const repository = createOrganizationRepository({
      query,
      transaction: async (work) => {
        transactionCount += 1
        return work(query)
      },
    })

    await expect(repository.submitOrganizationApplication(actorId, applicationInput())).resolves.toEqual({
      companyId: 'company-1',
      applicationId: 'application-1',
    })

    expect(transactionCount).toBe(1)
    const companyInsert = seen.find((entry) => entry.text.includes('insert into public.companies'))
    const memberInsert = seen.find((entry) => entry.text.includes('insert into public.company_members'))
    const applicationInsert = seen.find((entry) => entry.text.includes('insert into public.organization_applications'))

    expect(companyInsert?.values).toContain(actorId)
    expect(companyInsert?.values).toContain('Oceanic Shipping Pvt Ltd')
    // Display label in company_type, canonical code and type details in the new columns.
    expect(companyInsert?.values).toContain('Ship manager')
    expect(companyInsert?.values).toContain('ship_manager')
    expect(companyInsert?.values).toContain(JSON.stringify({ fleetSize: 12 }))
    expect(memberInsert?.text).toContain('approved_at')
    expect(memberInsert?.values).toEqual(['company-1', actorId, 'owner', null])
    expect(applicationInsert?.values).toContain('pending')
    expect(applicationInsert?.values).toContain('hiring@oceanic.example.com')
  })

  it('maps the current organization application state for the hiring entry point', async () => {
    const repository = createOrganizationRepository({
      query: async () => [{
        application_id: 'application-1',
        application_status: 'changes_requested',
        submitted_at: '2026-09-11T10:00:00.000Z',
        updated_at: '2026-09-11T12:00:00.000Z',
        admin_review_note: 'Please provide an official company email.',
        company_id: 'company-1',
        company_slug: 'oceanic-shipping',
        company_name: 'Oceanic Shipping',
        company_verified: false,
        member_role: 'owner',
        member_approved_at: null,
      }],
    })

    await expect(repository.getUserOrganizationState(actorId)).resolves.toEqual({
      kind: 'application',
      applicationId: 'application-1',
      status: 'changes_requested',
      submittedAt: '2026-09-11T10:00:00.000Z',
      updatedAt: '2026-09-11T12:00:00.000Z',
      adminReviewNote: 'Please provide an official company email.',
      company: {
        id: 'company-1',
        slug: 'oceanic-shipping',
        name: 'Oceanic Shipping',
        verified: false,
      },
      membership: {
        role: 'owner',
        approvedAt: null,
      },
    })
  })

  it('loads editable organization details only for the submitting user', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createOrganizationRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          application_id: 'application-1',
          organization_name: 'Oceanic Shipping Pvt Ltd',
          organization_type: 'Ship Management Company',
          website: 'https://oceanic.example.com',
          official_email: 'hiring@oceanic.example.com',
          office_locations: ['Mumbai, India'],
          description: 'Ship management and crewing company serving international owners.',
          fleet_summary: '12 managed tankers and bulk carriers.',
          vessel_types: ['Oil Tanker', 'Bulk Carrier'],
          applicant_role: 'Managing Director',
          registration_reference: 'CIN-12345',
          supporting_notes: 'Please verify our company profile for maritime hiring.',
        }]
      },
    })

    // A legacy free-text type is mapped to its type code so the form can pre-select it.
    await expect(repository.getOrganizationApplication(actorId, 'application-1')).resolves.toEqual({
      ...rawApplicationInput({ fleetSize: null }),
      organizationTypeOther: null,
      recruitmentLicence: null,
      servicesOffered: [],
      languages: [],
      helpline24x7: null,
      accreditation: null,
    })
    expect(seen[0]?.text).toContain('oa.submitted_by = $1')
    expect(seen[0]?.text).toContain('oa.id = $2')
    expect(seen[0]?.values).toEqual([actorId, 'application-1'])
  })

  it('resubmits only an existing changes-requested or rejected application and clears review state', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update')) {
        return [{ id: 'application-1', company_id: 'company-1', status: 'changes_requested', submitted_by: actorId }]
      }
      if (text.includes('update public.organization_applications')) return [{ id: 'application-1' }]
      return []
    }
    const repository = createOrganizationRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.resubmitOrganizationApplication(actorId, 'application-1', applicationInput({ supportingNotes: 'Official email updated.' }))).resolves.toBe(true)

    const applicationUpdate = seen.find((entry) => entry.text.includes('update public.organization_applications'))
    expect(applicationUpdate?.text).toContain("status = 'pending'")
    expect(applicationUpdate?.text).toContain('reviewed_by = null')
    expect(applicationUpdate?.text).toContain('reviewed_at = null')
    expect(applicationUpdate?.text).toContain('admin_review_note = null')
    expect(seen.some((entry) => entry.text.includes('update public.companies'))).toBe(true)
  })

  it('rejects resubmission of a pending application', async () => {
    const query = async (text: string) => {
      if (text.includes('for update')) {
        return [{ id: 'application-1', company_id: 'company-1', status: 'pending', submitted_by: actorId }]
      }
      return []
    }
    const repository = createOrganizationRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.resubmitOrganizationApplication(actorId, 'application-1', applicationInput())).rejects.toThrow('organization_resubmit_forbidden')
  })

  it('searches existing organizations without granting membership', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createOrganizationRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{ id: 'company-1', slug: 'oceanic', name: 'Oceanic Shipping', company_type: 'Ship Manager', is_verified: true, website: 'https://oceanic.example.com' }]
      },
    })

    await expect(repository.searchCompanies('oceanic')).resolves.toEqual([{
      id: 'company-1',
      slug: 'oceanic',
      name: 'Oceanic Shipping',
      companyType: 'Ship Manager',
      verified: true,
      unclaimed: false,
      website: 'https://oceanic.example.com',
    }])
    expect(seen[0]?.text).toContain('from public.companies')
    expect(seen[0]?.text).toContain('ilike')
    expect(seen[0]?.values).toEqual(['%oceanic%'])
  })

  it('requests controlled access to an existing organization without creating a duplicate company', async () => {
    const companyId = '33333333-3333-4333-8333-333333333333'
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.companies') && text.includes('where id = $1')) return [{ id: companyId }]
      if (text.includes('from public.company_members')) return []
      if (text.includes('insert into public.company_access_requests')) return [{ id: 'request-1' }]
      return []
    }
    const repository = createOrganizationRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.requestCompanyAccess(actorId, companyId, 'recruiter', 'I manage crewing for this company.')).resolves.toEqual({
      requestId: 'request-1',
    })

    const requestInsert = seen.find((entry) => entry.text.includes('insert into public.company_access_requests'))
    expect(requestInsert?.values).toEqual([
      companyId,
      actorId,
      'recruiter',
      'recruiter_access',
      'I manage crewing for this company.',
    ])
    expect(seen.some((entry) => entry.text.includes('insert into public.companies'))).toBe(false)
  })

  it('refuses a request to join an unclaimed organization, which nobody could approve', async () => {
    const companyId = '33333333-3333-4333-8333-333333333333'
    const seen: string[] = []
    const query = async (text: string) => {
      seen.push(text)
      if (text.includes('from public.companies') && text.includes('where id = $1')) return [{ id: companyId, claim_status: 'unclaimed' }]
      return []
    }
    const repository = createOrganizationRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.requestCompanyAccess(actorId, companyId, 'member', null)).rejects.toThrow('organization_unclaimed')
    expect(seen[0]).toContain("coalesce(to_jsonb(companies) ->> 'claim_status', 'claimed') as claim_status")
    expect(seen.some((text) => text.includes('insert into public.company_access_requests'))).toBe(false)
  })

  it('supports full Organization Pro role requests without creating a duplicate organization', async () => {
    const companyId = '33333333-3333-4333-8333-333333333333'
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.companies') && text.includes('where id = $1')) return [{ id: companyId }]
      if (text.includes('from public.company_members')) return []
      if (text.includes('insert into public.company_access_requests')) return [{ id: 'request-lms' }]
      return []
    }
    const repository = createOrganizationRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.requestCompanyAccess(actorId, companyId, 'lms_manager', 'I manage training for this institute.')).resolves.toEqual({
      requestId: 'request-lms',
    })

    const requestInsert = seen.find((entry) => entry.text.includes('insert into public.company_access_requests'))
    expect(requestInsert?.values).toEqual([
      companyId,
      actorId,
      'lms_manager',
      'role_access',
      'I manage training for this institute.',
    ])
  })

  it('fails closed when requesting access to a company the member already belongs to', async () => {
    const companyId = '33333333-3333-4333-8333-333333333333'
    const query = async (text: string) => {
      if (text.includes('from public.companies')) return [{ id: companyId }]
      if (text.includes('from public.company_members')) return [{ role: 'member', approved_at: '2026-09-01T00:00:00.000Z' }]
      return []
    }
    const repository = createOrganizationRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.requestCompanyAccess(actorId, companyId, 'member', null)).rejects.toThrow('organization_membership_exists')
  })

  it('lists the members organization access requests with company and review state', async () => {
    const repository = createOrganizationRepository({
      query: async () => [{
        request_id: 'request-1',
        status: 'pending',
        requested_role: 'administrator',
        request_type: 'recruiter_access',
        message: 'I am the company director.',
        requested_at: new Date('2026-09-24T10:00:00.000Z'),
        reviewed_at: null,
        reviewer_note: null,
        granted_role: null,
        decided_via: null,
        escalated_at: null,
        escalation_note: null,
        company_id: '33333333-3333-4333-8333-333333333333',
        company_slug: 'oceanic',
        company_name: 'Oceanic Shipping',
        company_verified: true,
      }],
    })

    await expect(repository.listUserAccessRequests(actorId)).resolves.toEqual([{
      id: 'request-1',
      status: 'pending',
      requestedRole: 'administrator',
      grantedRole: null,
      requestType: 'recruiter_access',
      message: 'I am the company director.',
      requestedAt: '2026-09-24T10:00:00.000Z',
      reviewedAt: null,
      reviewerNote: null,
      decidedVia: null,
      escalatedAt: null,
      escalationNote: null,
      company: {
        id: '33333333-3333-4333-8333-333333333333',
        slug: 'oceanic',
        name: 'Oceanic Shipping',
        verified: true,
      },
    }])
  })


  it('lists all approved organization memberships for publisher selection', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createOrganizationRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [
          {
            company_id: 'company-1',
            company_slug: 'oceanic',
            company_name: 'Oceanic Shipping',
            company_verified: true,
            member_role: 'event_manager',
          },
          {
            company_id: 'company-2',
            company_slug: 'academy',
            company_name: 'Sea Academy',
            company_verified: false,
            member_role: 'lms_manager',
          },
        ]
      },
    })

    await expect(repository.listUserOrganizations(actorId)).resolves.toEqual([
      {
        id: 'company-1',
        slug: 'oceanic',
        name: 'Oceanic Shipping',
        verified: true,
        role: 'event_manager',
      },
      {
        id: 'company-2',
        slug: 'academy',
        name: 'Sea Academy',
        verified: false,
        role: 'lms_manager',
      },
    ])

    expect(seen[0]?.text).toContain('public.company_members')
    expect(seen[0]?.text).toContain('cm.approved_at is not null')
    expect(seen[0]?.values).toEqual([actorId])
  })

})
