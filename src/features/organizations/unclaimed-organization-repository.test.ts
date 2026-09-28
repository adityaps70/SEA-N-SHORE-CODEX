import { describe, expect, it, vi } from 'vitest'
import type { ParsedOrganizationApplicationInput } from './schemas'
import { organizationApplicationSchema } from './schemas'
import {
  createUnclaimedOrganizationRepository,
  UnclaimedOrganizationError,
} from './unclaimed-organization-repository'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999'
const COMPANY_ID = '22222222-2222-4222-8222-222222222222'

type Row = Record<string, unknown>
type RepositoryDeps = NonNullable<Parameters<typeof createUnclaimedOrganizationRepository>[0]>
type Handler = (text: string, values: readonly unknown[]) => Row[] | undefined

/** A fake database: each SQL statement is answered by the first handler that matches it. */
function fakeDatabase(handlers: Array<[RegExp, Row[] | Handler]>) {
  const calls: Array<{ text: string; values: readonly unknown[] }> = []
  const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
    calls.push({ text, values })
    for (const [pattern, answer] of handlers) {
      if (pattern.test(text)) {
        const rows = typeof answer === 'function' ? answer(text, values) : answer
        if (rows) return rows
      }
    }
    return []
  })
  const transaction = vi.fn(async <T,>(work: (q: typeof query) => Promise<T>) => work(query))
  return {
    query: query as unknown as RepositoryDeps['query'],
    transaction: transaction as unknown as RepositoryDeps['transaction'],
    calls,
    find: (pattern: RegExp) => calls.filter((call) => pattern.test(call.text)),
  }
}

const DUPLICATE = /where lower\(btrim\(c\.name\)\) = lower\(\$1\)/

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(UnclaimedOrganizationError)
  await promise.catch((error: UnclaimedOrganizationError) => expect(error.code).toBe(code))
}

function claimInput(overrides: Record<string, unknown> = {}): ParsedOrganizationApplicationInput {
  return organizationApplicationSchema.parse({
    organizationName: 'Harbour Crew Services',
    organizationType: 'union',
    website: 'https://harbourcrew.example',
    officialEmail: 'Director@HarbourCrew.example',
    officeLocation: 'Kochi, India',
    description: 'Crew welfare and representation for seafarers in Kerala.',
    applicantRole: 'Director',
    registrationReference: 'REG-1',
    supportingNotes: null,
    ...overrides,
  })
}

describe('unclaimed organization repository: adding a page', () => {
  it('creates an unclaimed organization with the member as creator and records an audit event', async () => {
    const db = fakeDatabase([
      [/count\(\*\) as total/, [{ total: 1 }]],
      [/insert into public\.companies/, [{ id: COMPANY_ID, slug: 'blue-anchor-marine-abc123', name: 'Blue Anchor Marine' }]],
    ])
    const repository = createUnclaimedOrganizationRepository({ ...db, slug: () => 'blue-anchor-marine-abc123' })

    const organization = await repository.createUnclaimedOrganization(USER_ID, {
      name: 'Blue  Anchor Marine ',
      organizationType: 'ship_manager',
      location: 'Kochi, India',
      website: 'https://blueanchor.example',
    })

    expect(organization).toEqual({
      id: COMPANY_ID, slug: 'blue-anchor-marine-abc123', name: 'Blue Anchor Marine', logoUrl: null, verified: false, unclaimed: true,
    })
    expect(db.find(/pg_advisory_xact_lock/)[0]?.values).toEqual(['Blue Anchor Marine'])
    expect(db.find(DUPLICATE)[0]?.values).toEqual(['Blue Anchor Marine', null])
    const insert = db.find(/insert into public\.companies/)[0]
    expect(insert?.text).toContain("'unclaimed'")
    expect(insert?.values).toEqual([
      'blue-anchor-marine-abc123', 'Blue Anchor Marine', 'Ship manager', 'ship_manager', 'https://blueanchor.example', ['Kochi, India'], USER_ID,
    ])
    expect(db.find(/organization\.unclaimed_created/)).toHaveLength(1)
  })

  it('blocks an exact duplicate name and hands back the listed organization to choose instead', async () => {
    const db = fakeDatabase([
      [DUPLICATE, [{ id: COMPANY_ID, slug: 'oceanic', name: 'Oceanic Ship Management', has_logo: false, is_verified: true, claim_status: 'claimed', listable: true }]],
    ])
    const repository = createUnclaimedOrganizationRepository(db)

    const attempt = repository.createUnclaimedOrganization(USER_ID, { name: 'oceanic ship management', organizationType: 'ship_manager', location: 'Mumbai', website: null })

    await expectCode(attempt, 'organization_duplicate_name')
    await attempt.catch((error: UnclaimedOrganizationError) => {
      expect(error.existing).toMatchObject({ id: COMPANY_ID, name: 'Oceanic Ship Management', verified: true, unclaimed: false })
    })
    expect(db.find(/insert into public\.companies/)).toHaveLength(0)
  })

  it('does not reveal an organization that is still in review, but still blocks the name', async () => {
    const db = fakeDatabase([
      [DUPLICATE, [{ id: COMPANY_ID, slug: 'oceanic', name: 'Oceanic', has_logo: false, is_verified: false, claim_status: 'claimed', listable: false }]],
    ])
    const repository = createUnclaimedOrganizationRepository(db)

    await expectCode(
      repository.createUnclaimedOrganization(USER_ID, { name: 'Oceanic', organizationType: 'ship_manager', location: 'Mumbai', website: null }),
      'organization_duplicate_in_review',
    )
  })

  it('limits how many unclaimed pages one member adds in a day', async () => {
    const db = fakeDatabase([[/count\(\*\) as total/, [{ total: '5' }]]])
    const repository = createUnclaimedOrganizationRepository(db)

    await expectCode(
      repository.createUnclaimedOrganization(USER_ID, { name: 'New Co', organizationType: 'other', location: 'Goa', website: null }),
      'unclaimed_organization_rate_limited',
    )
    expect(db.find(/insert into public\.companies/)).toHaveLength(0)
  })

  it('turns a unique-index race into a duplicate-name error', async () => {
    let inserts = 0
    const db = fakeDatabase([
      [/count\(\*\) as total/, [{ total: 0 }]],
      [/insert into public\.companies/, () => {
        inserts += 1
        throw Object.assign(new Error('duplicate key value'), { code: '23505' })
      }],
      [DUPLICATE, () => (inserts ? [{ id: COMPANY_ID, slug: 'new-co', name: 'New Co', has_logo: false, is_verified: false, claim_status: 'unclaimed', listable: true }] : undefined)],
    ])
    const repository = createUnclaimedOrganizationRepository(db)

    const attempt = repository.createUnclaimedOrganization(USER_ID, { name: 'New Co', organizationType: 'other', location: 'Goa', website: null })
    await expectCode(attempt, 'organization_duplicate_name')
  })

  it('reports name conflicts for the registration flow', async () => {
    const listed = fakeDatabase([[DUPLICATE, [{ id: COMPANY_ID, slug: 's', name: 'Sea Co', has_logo: true, is_verified: false, claim_status: 'unclaimed', listable: true }]]])
    await expect(createUnclaimedOrganizationRepository(listed).findNameConflict(' sea  co ')).resolves.toEqual({
      kind: 'listed',
      organization: { id: COMPANY_ID, slug: 's', name: 'Sea Co', logoUrl: `/api/company-logo/${COMPANY_ID}`, verified: false, unclaimed: true },
    })
    expect(listed.find(DUPLICATE)[0]?.values).toEqual(['sea co', null])

    const none = fakeDatabase([])
    await expect(createUnclaimedOrganizationRepository(none).findNameConflict('Sea Co')).resolves.toBeNull()
    await expect(createUnclaimedOrganizationRepository(none).findNameConflict('a')).resolves.toBeNull()
  })
})

describe('unclaimed organization repository: claiming a page', () => {
  function claimDatabase(options: { claimStatus?: string; ownOther?: Row[]; existing?: Row[]; duplicate?: Row[] } = {}) {
    return fakeDatabase([
      [/from public\.companies c\s+where c\.id = \$1\s+for update/, [{ id: COMPANY_ID, slug: 'harbour-crew-abc123', name: 'Harbour Crew', claim_status: options.claimStatus ?? 'unclaimed' }]],
      [/and company_id <> \$2/, options.ownOther ?? []],
      [/from public\.organization_applications\s+where company_id = \$1\s+for update/, options.existing ?? []],
      [DUPLICATE, options.duplicate ?? []],
      [/insert into public\.organization_applications/, [{ id: 'application-1' }]],
      [/update public\.organization_applications/, [{ id: 'application-1' }]],
    ])
  }

  it('submits a claim for review, updates the page details and makes the claimant an unapproved owner', async () => {
    const db = claimDatabase()
    const repository = createUnclaimedOrganizationRepository(db)

    await expect(repository.submitClaim(USER_ID, COMPANY_ID, claimInput())).resolves.toEqual({
      applicationId: 'application-1', companyId: COMPANY_ID, slug: 'harbour-crew-abc123',
    })

    const update = db.find(/update public\.companies\s+set name = \$2/)[0]
    expect(update?.values.slice(0, 3)).toEqual([COMPANY_ID, 'Harbour Crew Services', 'Trade union'])
    const membership = db.find(/insert into public\.company_members/)[0]
    expect(membership?.text).toContain("'owner'::public.company_member_role, null")
    expect(membership?.text).toContain('approved_at = null')
    const application = db.find(/insert into public\.organization_applications/)[0]
    expect(application?.text).toContain("'pending', 'claim'")
    expect(application?.values).toEqual([COMPANY_ID, USER_ID, 'director@harbourcrew.example', 'REG-1', 'Director', null])
    expect(db.find(/organization\.claim_submitted/)).toHaveLength(1)
  })

  it('refuses pages that are already claimed', async () => {
    const repository = createUnclaimedOrganizationRepository(claimDatabase({ claimStatus: 'claimed' }))
    await expectCode(repository.submitClaim(USER_ID, COMPANY_ID, claimInput()), 'organization_already_claimed')
  })

  it('allows one organization review at a time per member', async () => {
    const repository = createUnclaimedOrganizationRepository(claimDatabase({ ownOther: [{ id: 'a', status: 'pending', submitted_by: USER_ID }] }))
    await expectCode(repository.submitClaim(USER_ID, COMPANY_ID, claimInput()), 'organization_application_in_progress')
  })

  it('refuses a second claim while one is being reviewed', async () => {
    const other = createUnclaimedOrganizationRepository(claimDatabase({ existing: [{ id: 'a', status: 'pending', submitted_by: OTHER_USER_ID }] }))
    await expectCode(other.submitClaim(USER_ID, COMPANY_ID, claimInput()), 'organization_claim_in_review')

    const own = createUnclaimedOrganizationRepository(claimDatabase({ existing: [{ id: 'a', status: 'changes_requested', submitted_by: USER_ID }] }))
    await expectCode(own.submitClaim(USER_ID, COMPANY_ID, claimInput()), 'organization_claim_own_review')

    const suspended = createUnclaimedOrganizationRepository(claimDatabase({ existing: [{ id: 'a', status: 'suspended', submitted_by: OTHER_USER_ID }] }))
    await expectCode(suspended.submitClaim(USER_ID, COMPANY_ID, claimInput()), 'organization_claim_unavailable')
  })

  it('lets a new claimant take over a claim that was not approved', async () => {
    const db = claimDatabase({ existing: [{ id: 'application-1', status: 'rejected', submitted_by: OTHER_USER_ID }] })
    const repository = createUnclaimedOrganizationRepository(db)

    await repository.submitClaim(USER_ID, COMPANY_ID, claimInput())

    const removed = db.find(/delete from public\.company_members/)[0]
    expect(removed?.values).toEqual([COMPANY_ID, OTHER_USER_ID])
    expect(removed?.text).toContain('approved_at is null')
    const update = db.find(/update public\.organization_applications/)[0]
    expect(update?.text).toContain("request_kind = 'claim'")
    expect(update?.text).toContain('reviewed_by = null')
    expect(update?.values[1]).toBe(USER_ID)
    expect(db.find(/insert into public\.organization_applications/)).toHaveLength(0)
  })

  it('blocks renaming a claimed page to another organization\'s name', async () => {
    const repository = createUnclaimedOrganizationRepository(claimDatabase({
      duplicate: [{ id: 'other', slug: 'x', name: 'Harbour Crew Services', has_logo: false, is_verified: true, claim_status: 'claimed', listable: true }],
    }))
    await expectCode(repository.submitClaim(USER_ID, COMPANY_ID, claimInput()), 'organization_duplicate_name')
  })

  it('loads a claimable page with its details to prefill the claim form', async () => {
    const db = fakeDatabase([[/where c\.slug = \$1/, [{
      id: COMPANY_ID, slug: 'harbour-crew', name: 'Harbour Crew', has_logo: false, company_type: 'Trade union', organization_type: 'union',
      organization_details: {}, website: null, office_locations: ['Kochi, India'], description: null, fleet_summary: null, vessel_types: [], claim_status: 'unclaimed',
    }]]])
    const organization = await createUnclaimedOrganizationRepository(db).getClaimableOrganization('harbour-crew')

    expect(organization).toMatchObject({ id: COMPANY_ID, unclaimed: true, prefill: { organizationName: 'Harbour Crew', organizationType: 'union', officeLocation: 'Kochi, India', officialEmail: '' } })
    expect(db.calls[0]?.text).toContain("coalesce(to_jsonb(c) ->> 'claim_status', 'claimed') = 'unclaimed'")
  })
})
