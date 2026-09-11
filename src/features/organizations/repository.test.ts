import { describe, expect, it } from 'vitest'
import { createOrganizationRepository, type OrganizationApplicationInput } from './repository'

const actorId = '11111111-1111-4111-8111-111111111111'

function applicationInput(overrides: Partial<OrganizationApplicationInput> = {}): OrganizationApplicationInput {
  return {
    organizationName: 'Oceanic Shipping Pvt Ltd',
    organizationType: 'Ship Management Company',
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
      website: 'https://oceanic.example.com',
    }])
    expect(seen[0]?.text).toContain('from public.companies')
    expect(seen[0]?.text).toContain('ilike')
    expect(seen[0]?.values).toEqual(['%oceanic%'])
  })
})
