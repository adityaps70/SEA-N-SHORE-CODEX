import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  requireAwsUser: vi.fn(async () => ({ id: 'partner-1' })),
  adminActionMfaMissing: vi.fn(async () => false),
  resolveSectionScope: vi.fn(),
  groupCountry: vi.fn(async (): Promise<string | null> => 'PH'),
  updateGroupAsAdmin: vi.fn(async () => undefined),
  archiveGroup: vi.fn(async () => undefined),
  unarchiveGroup: vi.fn(async () => undefined),
  createGroup: vi.fn(),
  setGroupOwner: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser }))
vi.mock('@/features/admin/mfa-gate', () => ({ ADMIN_MFA_REQUIRED_MESSAGE: 'mfa-required', adminActionMfaMissing: mocks.adminActionMfaMissing }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/country-admins/scope', async (original) => ({
  ...(await original<typeof import('@/features/country-admins/scope')>()),
  resolveSectionScope: mocks.resolveSectionScope,
}))
vi.mock('./admin-scope', () => ({ adminQuery: vi.fn(), communityGroupCountry: mocks.groupCountry }))
vi.mock('./actions', () => ({ communityErrorMessage: async () => 'failed' }))
vi.mock('./service', () => ({
  communityService: {
    updateGroupAsAdmin: mocks.updateGroupAsAdmin,
    archiveGroup: mocks.archiveGroup,
    unarchiveGroup: mocks.unarchiveGroup,
    createGroup: mocks.createGroup,
    setGroupOwner: mocks.setGroupOwner,
    findOwner: vi.fn(),
  },
}))

const actions = await import('./admin-actions')

const GROUP = '11111111-1111-4111-8111-111111111111'

function form(fields: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const groupFields = { groupId: GROUP, name: 'Placeholder Crew', description: '', rules: '', visibility: 'public', joinPolicy: 'open', icon: '', categoryId: '22222222-2222-4222-8222-222222222222' }

/** Round GP Part E: country admins on Admin › Communities. */
describe('community admin actions for country admins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePlatformAdministratorUser.mockRejectedValue(new Error('admin_forbidden'))
    mocks.resolveSectionScope.mockResolvedValue({ kind: 'country', countries: ['PH'], level: 'act' })
    mocks.groupCountry.mockResolvedValue('PH')
  })

  it('lets platform administrators edit as before, audited as a platform administrator', async () => {
    mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
    expect(await actions.updateGroupAsAdmin(null, form(groupFields))).toEqual({ ok: true, message: 'Group saved.' })
    expect(mocks.updateGroupAsAdmin).toHaveBeenCalledWith('admin-1', GROUP, expect.any(Object), { actorRole: 'platform_admin', section: 'communities', country: 'PH' })
  })

  it('lets a country admin with Communities (act) edit, archive and unarchive their countries’ groups', async () => {
    expect(await actions.updateGroupAsAdmin(null, form(groupFields))).toEqual({ ok: true, message: 'Group saved.' })
    const audit = { actorRole: 'country_admin', section: 'communities', country: 'PH' }
    expect(mocks.updateGroupAsAdmin).toHaveBeenCalledWith('partner-1', GROUP, expect.any(Object), audit)
    await actions.archiveGroupAsAdmin(form({ groupId: GROUP }))
    await actions.unarchiveGroupAsAdmin(form({ groupId: GROUP }))
    expect(mocks.archiveGroup).toHaveBeenCalledWith('partner-1', GROUP, audit)
    expect(mocks.unarchiveGroup).toHaveBeenCalledWith('partner-1', GROUP, audit)
    expect(mocks.resolveSectionScope).toHaveBeenCalledWith(expect.anything(), 'partner-1', 'communities', 'act')
  })

  it('refuses groups outside their countries or without a country, a missing authenticator, and view-only access', async () => {
    mocks.groupCountry.mockResolvedValueOnce('IN')
    expect(await actions.updateGroupAsAdmin(null, form(groupFields))).toMatchObject({ ok: false, error: expect.stringMatching(/not in your countries/) })
    mocks.groupCountry.mockResolvedValueOnce(null)
    await actions.archiveGroupAsAdmin(form({ groupId: GROUP }))
    mocks.adminActionMfaMissing.mockResolvedValueOnce(true)
    expect(await actions.updateGroupAsAdmin(null, form(groupFields))).toEqual({ ok: false, error: 'mfa-required' })
    mocks.resolveSectionScope.mockRejectedValueOnce(new Error('admin_forbidden'))
    expect(await actions.updateGroupAsAdmin(null, form(groupFields))).toMatchObject({ ok: false })
    expect(mocks.updateGroupAsAdmin).not.toHaveBeenCalled()
    expect(mocks.archiveGroup).not.toHaveBeenCalled()
  })

  it('never lets a country admin create a group or change its owner', async () => {
    expect(await actions.createGroupAsAdmin(null, form({ ...groupFields, owner: 'placeholder-owner' }))).toMatchObject({ ok: false })
    expect(await actions.setGroupOwnerAsAdmin(null, form({ groupId: GROUP, owner: 'placeholder-owner' }))).toMatchObject({ ok: false })
    expect(mocks.createGroup).not.toHaveBeenCalled()
    expect(mocks.setGroupOwner).not.toHaveBeenCalled()
  })
})
