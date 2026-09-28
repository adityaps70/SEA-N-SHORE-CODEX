import { describe, expect, it } from 'vitest'
import { createAdminRepository, organizationDirectoryStatus } from './repository'

const adminId = '11111111-1111-4111-8111-111111111111'

const directoryRow = {
  company_id: '33333333-3333-4333-8333-333333333333',
  slug: 'oceanic-shipping',
  name: 'Oceanic Shipping',
  logo_path: 'companies/33333333/logo-abc.png',
  company_type: 'Ship Management Company',
  organization_type: null,
  location: 'Mumbai, India',
  verified: true,
  created_at: '2026-09-11T10:00:00.000Z',
  application_id: '22222222-2222-4222-8222-222222222222',
  application_status: 'approved',
  owner_id: '44444444-4444-4444-8444-444444444444',
  owner_name: 'Asha Singh',
  owner_slug: 'asha-singh',
  member_count: '3',
  organization_pro: true,
  claim_status: 'claimed',
  total_count: '120',
}

type Seen = Array<{ text: string; values?: readonly unknown[] }>

function repositoryWith(options: { claimColumn: boolean; rows?: unknown[]; now?: () => number }, seen: Seen) {
  return createAdminRepository({
    now: options.now,
    query: async (text, values) => {
      seen.push({ text, values })
      if (text.includes('public.user_roles ur')) return [{ allowed: true }]
      if (text.includes('information_schema.columns')) return options.claimColumn ? [{ present: 1 }] : []
      if (text.includes('from public.companies c')) return (options.rows ?? []) as never[]
      return []
    },
  })
}

describe('admin organization directory', () => {
  it('lists every organization with owner, members, plan and status from one query', async () => {
    const seen: Seen = []
    const repository = repositoryWith({ claimColumn: true, rows: [directoryRow] }, seen)

    const page = await repository.listOrganizations(adminId, { query: '', status: 'all', limit: 51 })

    expect(page.total).toBe(120)
    expect(page.organizations).toEqual([{
      id: directoryRow.company_id,
      slug: 'oceanic-shipping',
      name: 'Oceanic Shipping',
      logoPath: 'companies/33333333/logo-abc.png',
      type: expect.any(String),
      location: 'Mumbai, India',
      owner: { id: directoryRow.owner_id, fullName: 'Asha Singh', slug: 'asha-singh' },
      memberCount: 3,
      plan: 'organization_pro',
      status: 'verified',
      applicationId: directoryRow.application_id,
      claimStatus: 'claimed',
      createdAt: '2026-09-11T10:00:00.000Z',
    }])
    const list = seen.find((entry) => entry.text.includes('from public.companies c'))!
    expect(list.text).toContain('count(*) over ()')
    expect(list.text).toContain("s.plan_code = 'organization_pro'")
    expect(list.text).toContain('c.claim_status')
    expect(list.text).not.toMatch(/\bwhere\s+order by/)
    expect(list.values).toEqual([51, 0])
  })

  it('works before migration 0050: derives unclaimed from a missing owner instead of reading claim_status', async () => {
    const seen: Seen = []
    const repository = repositoryWith({ claimColumn: false, rows: [{ ...directoryRow, owner_id: null, owner_name: null, claim_status: 'unclaimed' }] }, seen)

    const page = await repository.listOrganizations(adminId, { query: '', status: 'unclaimed', limit: 51 })

    const list = seen.find((entry) => entry.text.includes('from public.companies c'))!
    expect(list.text).not.toContain('c.claim_status')
    expect(list.text).toContain("case when org_owner.owner_id is null then 'unclaimed' else 'claimed' end = 'unclaimed'")
    expect(page.organizations[0]).toMatchObject({ owner: null, claimStatus: 'unclaimed' })
  })

  it('checks for the claim_status column once, and rechecks a missing column after a minute', async () => {
    const seen: Seen = []
    let clock = 0
    const repository = repositoryWith({ claimColumn: false, now: () => clock }, seen)
    const schemaChecks = () => seen.filter((entry) => entry.text.includes('information_schema.columns')).length

    await repository.listOrganizations(adminId, { query: '', status: 'all', limit: 51 })
    await repository.listOrganizations(adminId, { query: '', status: 'all', limit: 51 })
    expect(schemaChecks()).toBe(1)

    clock = 61_000
    await repository.listOrganizations(adminId, { query: '', status: 'all', limit: 51 })
    expect(schemaChecks()).toBe(2)
  })

  it('filters by review state, verification and search with escaped wildcards, and pages with an offset', async () => {
    const seen: Seen = []
    const repository = repositoryWith({ claimColumn: true }, seen)

    await repository.listOrganizations(adminId, { query: '50%_Off', status: 'pending', limit: 51, offset: 50 })
    const pending = seen.filter((entry) => entry.text.includes('from public.companies c')).at(-1)!
    expect(pending.values).toEqual(['%50\\%\\_off%', 'pending', 51, 50])
    expect(pending.text).toContain('oa.status = $2')
    expect(pending.text).toContain('lower(c.name) like $1')
    expect(pending.text).toContain('offset $4')

    await repository.listOrganizations(adminId, { query: '', status: 'verified', limit: 51 })
    const verified = seen.filter((entry) => entry.text.includes('from public.companies c')).at(-1)!
    expect(verified.text).toContain("coalesce(c.is_verified, false) and coalesce(oa.status, '') <> 'suspended'")
    expect(verified.values).toEqual([51, 0])
  })

  it('refuses non-administrators before reading any organization', async () => {
    const seen: Seen = []
    const repository = createAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return []
      },
    })

    await expect(repository.listOrganizations(adminId, { query: '', status: 'all', limit: 51 })).rejects.toThrow()
    expect(seen.some((entry) => entry.text.includes('from public.companies c'))).toBe(false)
  })
})

describe('organizationDirectoryStatus', () => {
  it('puts suspension ahead of verification and names organizations without an application', () => {
    expect(organizationDirectoryStatus('suspended', true)).toBe('suspended')
    expect(organizationDirectoryStatus('approved', true)).toBe('verified')
    expect(organizationDirectoryStatus(null, true)).toBe('verified')
    expect(organizationDirectoryStatus('approved', false)).toBe('approved')
    expect(organizationDirectoryStatus('changes_requested', false)).toBe('changes_requested')
    expect(organizationDirectoryStatus('rejected', false)).toBe('rejected')
    expect(organizationDirectoryStatus(null, false)).toBe('no_application')
  })
})
