import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityCreationOptions } from './eligibility-server'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getCommunityCreationEligibility: vi.fn(),
  createGroup: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((href: string) => { throw new Error(`NEXT_REDIRECT:${href}`) }),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./eligibility-server', () => ({ getCommunityCreationEligibility: mocks.getCommunityCreationEligibility }))
vi.mock('./service', () => ({ communityService: { createGroup: mocks.createGroup } }))

import { createCommunity } from './create-actions'

const userId = '11111111-1111-4111-8111-111111111111'
const companyId = '33333333-3333-4333-8333-333333333333'
const groupId = '22222222-2222-4222-8222-222222222222'

function options(overrides: Partial<CommunityCreationOptions['eligibility']> = {}): CommunityCreationOptions {
  return {
    isPlatformAdmin: false,
    personalPlan: 'creator_pro',
    organizations: [],
    eligibility: {
      canCreate: true,
      reasons: [],
      asMember: { allowed: true, reason: null },
      asOrganizations: [],
      ...overrides,
    },
  }
}

function form(fields: Record<string, string | File>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

/** jsdom's File has no arrayBuffer(); Node's does. Same shim as media-actions.test.ts. */
function image(bytes: number[], name: string, type: string) {
  const file = new File([new Uint8Array(bytes)], name, { type })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(bytes).buffer })
  return file
}

const validFields = { name: 'Tanker Cargo Officers', description: 'Cargo ops.', rules: 'Be kind.', joinPolicy: 'approval', visibility: 'public' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: userId })
  mocks.getCommunityCreationEligibility.mockResolvedValue(options())
  mocks.createGroup.mockResolvedValue({ id: groupId, slug: 'tanker-cargo-officers' })
})

describe('createCommunity', () => {
  it('creates a community for a Creator Pro member and redirects to its page', async () => {
    await expect(createCommunity(null, form({ ...validFields, as: 'me' }))).resolves.toEqual({ ok: true, id: groupId, slug: 'tanker-cargo-officers' })
    expect(mocks.getCommunityCreationEligibility).toHaveBeenCalledWith(userId)
    expect(mocks.createGroup).toHaveBeenCalledWith(userId, {
      name: 'Tanker Cargo Officers', description: 'Cargo ops.', rules: 'Be kind.', visibility: 'public', joinPolicy: 'approval', icon: null, ownerId: userId, ownerCompanyId: null, category: null,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/community')
  })

  it('enforces eligibility on the server even when the form claims otherwise', async () => {
    mocks.getCommunityCreationEligibility.mockResolvedValue(options({ canCreate: false, reasons: ['creator_pro_required'], asMember: { allowed: false, reason: 'creator_pro_required' } }))
    await expect(createCommunity(null, form({ ...validFields, as: 'me' }))).resolves.toEqual({ ok: false, error: 'Creating a community for yourself is part of Creator Pro.' })
    expect(mocks.createGroup).not.toHaveBeenCalled()

    mocks.getCommunityCreationEligibility.mockResolvedValue(options({ asMember: { allowed: false, reason: 'limit_reached' } }))
    const limit = await createCommunity(null, form(validFields))
    expect(limit).toMatchObject({ ok: false, error: expect.stringContaining('one community') })
  })

  it('creates for an organization the member may create for, and refuses others', async () => {
    mocks.getCommunityCreationEligibility.mockResolvedValue(options({
      asMember: { allowed: false, reason: 'creator_pro_required' },
      asOrganizations: [
        { companyId, allowed: true, reason: null },
        { companyId: '44444444-4444-4444-8444-444444444444', allowed: false, reason: 'organization_pro_required' },
      ],
    }))
    await expect(createCommunity(null, form({ ...validFields, as: companyId }))).resolves.toMatchObject({ ok: true })
    expect(mocks.createGroup).toHaveBeenCalledWith(userId, expect.objectContaining({ ownerId: userId, ownerCompanyId: companyId }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations/[slug]', 'page')

    mocks.createGroup.mockClear()
    await expect(createCommunity(null, form({ ...validFields, as: '44444444-4444-4444-8444-444444444444' }))).resolves.toEqual({
      ok: false, error: 'Creating a community for an organization is part of Organization Pro (for verified organizations).',
    })
    await expect(createCommunity(null, form({ ...validFields, as: '55555555-5555-4555-8555-555555555555' }))).resolves.toEqual({ ok: false, error: 'You are not part of that organization.' })
    // The member option is blocked here, so "as me" fails too.
    await expect(createCommunity(null, form({ ...validFields, as: 'me' }))).resolves.toMatchObject({ ok: false })
    expect(mocks.createGroup).not.toHaveBeenCalled()
  })

  it('validates the fields before touching the database', async () => {
    await expect(createCommunity(null, form({ ...validFields, name: 'A' }))).resolves.toEqual({ ok: false, error: 'Give the community a name (2 to 80 characters).' })
    await expect(createCommunity(null, form({ ...validFields, joinPolicy: 'whenever' }))).resolves.toEqual({ ok: false, error: 'Choose how members join: Open or Approval required.' })
    expect(mocks.getCommunityCreationEligibility).not.toHaveBeenCalled()
    expect(mocks.createGroup).not.toHaveBeenCalled()
  })

  it('creates the group using metadata only, without posting image bytes to the server', async () => {
    const cover = image([1, 2, 3], 'banner.webp', 'image/webp')
    await expect(createCommunity(null, form({ ...validFields, cover }))).resolves.toMatchObject({ ok: true, id: groupId })
    expect(mocks.createGroup).toHaveBeenCalledTimes(1)
  })
})
