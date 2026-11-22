import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMember: vi.fn(),
  grant: vi.fn(async () => ({})),
  getCountries: vi.fn(async (): Promise<string[] | null> => ['PH']),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: async () => ({ id: 'admin-1' }) }))
vi.mock('@/features/admin/mfa-gate', () => ({ ADMIN_MFA_REQUIRED_MESSAGE: 'mfa', adminActionMfaMissing: async () => false }))
vi.mock('./repository', async (original) => ({
  ...(await original<typeof import('./repository')>()),
  countryAdminRepository: { findMember: mocks.findMember, grant: mocks.grant, getCountries: mocks.getCountries },
}))

const { grantCountryAdminAction, updateCountryAdminAction } = await import('./admin-actions')

const idle = { status: 'idle' as const, revision: 0 }
const PROFILE = '11111111-1111-4111-8111-111111111111'

function form(fields: Record<string, string | string[]>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) for (const item of [value].flat()) data.append(key, item)
  return data
}

/** Round GP Part E: the section tickboxes reach the repository as View / Act per section. */
describe('country admin actions and sections', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the ticked sections when adding a country admin (act wins over view)', async () => {
    mocks.findMember.mockResolvedValue({ id: PROFILE, fullName: 'Placeholder Partner', isPlatformAdministrator: false })
    const result = await grantCountryAdminAction(idle, form({ member: 'placeholder-partner', countries: ['PH'], view_organizations: '1', act_organizations: '1', view_members: '1' }))
    expect(result).toMatchObject({ status: 'saved' })
    expect(mocks.grant).toHaveBeenCalledWith('admin-1', PROFILE, ['PH'], { organizations: 'act', members: 'view' })
  })

  it('refuses a country admin with no section ticked', async () => {
    mocks.findMember.mockResolvedValue({ id: PROFILE, fullName: 'Placeholder Partner', isPlatformAdministrator: false })
    expect(await grantCountryAdminAction(idle, form({ member: 'placeholder-partner', countries: ['PH'] }))).toMatchObject({ status: 'error', message: 'Give at least one section.' })
    expect(await updateCountryAdminAction(idle, form({ profileId: PROFILE, countries: ['PH'] }))).toMatchObject({ status: 'error', message: 'Give at least one section.' })
    expect(mocks.grant).not.toHaveBeenCalled()
  })

  it('saves countries and sections together when editing', async () => {
    expect(await updateCountryAdminAction(idle, form({ profileId: PROFILE, countries: ['PH', 'SG'], view_overview: '1', view_organizations: '1' })))
      .toMatchObject({ status: 'saved', message: 'Countries and sections saved.' })
    expect(mocks.grant).toHaveBeenCalledWith('admin-1', PROFILE, ['PH', 'SG'], { overview: 'view', organizations: 'view' })
  })
})
