import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  requireCapability: vi.fn(),
  getById: vi.fn(),
  updateBranding: vi.fn(),
  updateLogoPath: vi.fn(),
  updateCoverPath: vi.fn(),
  putMediaObject: vi.fn(),
  deleteMediaObject: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ requireCapability: mocks.requireCapability }))
vi.mock('@/lib/aws/storage', () => ({ putMediaObject: mocks.putMediaObject, deleteMediaObject: mocks.deleteMediaObject }))
vi.mock('./workspace-repository', () => ({
  organizationWorkspaceRepository: {
    getById: mocks.getById,
    updateBranding: mocks.updateBranding,
    updateLogoPath: mocks.updateLogoPath,
    updateCoverPath: mocks.updateCoverPath,
  },
}))

import { updateOrganizationBranding } from './workspace-actions'

const companyId = '22222222-2222-4222-8222-222222222222'

function form(entries: Record<string, string | File>) {
  const data = new FormData()
  data.set('companyId', companyId)
  data.set('website', 'https://oceanic.example')
  data.set('description', 'Ship management')
  data.set('officeLocations', 'Mumbai, Singapore')
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

function image(name: string, type = 'image/jpeg', size = 10) {
  const file = new File([new Uint8Array(size)], name, { type })
  // jsdom's File has no arrayBuffer(); Node's (used by server actions) does.
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(size) })
  }
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.requireCapability.mockResolvedValue(undefined)
  mocks.getById.mockResolvedValue({ id: companyId, slug: 'oceanic', organizationType: 'ship_manager', logoPath: null, coverPath: 'organizations/old-cover.jpg' })
  mocks.updateBranding.mockResolvedValue(true)
  mocks.updateLogoPath.mockResolvedValue(true)
  mocks.updateCoverPath.mockResolvedValue(true)
  mocks.putMediaObject.mockResolvedValue(undefined)
  mocks.deleteMediaObject.mockResolvedValue(undefined)
})

describe('updateOrganizationBranding page details', () => {
  it('checks the branding capability on the server before saving', async () => {
    mocks.requireCapability.mockRejectedValue(new Error('capability_required'))
    const result = await updateOrganizationBranding({}, form({ tagline: 'Crew care' }))
    expect(mocks.requireCapability).toHaveBeenCalledWith('user-1', 'organization.branding', { companyId })
    expect(result.error).toBe('Organization Pro branding access is required to edit this workspace.')
    expect(mocks.updateBranding).not.toHaveBeenCalled()
  })

  it('saves tagline, company size and de-duplicated specialities', async () => {
    const result = await updateOrganizationBranding({}, form({ tagline: '  Tanker   management  ', companySize: '51-200', specialties: 'LNG, Crewing, LNG, ' }))
    expect(result).toEqual({ success: true })
    expect(mocks.updateBranding).toHaveBeenCalledWith(companyId, expect.objectContaining({
      tagline: 'Tanker management',
      companySize: '51-200',
      specialties: ['LNG', 'Crewing'],
      officeLocations: ['Mumbai', 'Singapore'],
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations/oceanic/manage')
  })

  it('explains invalid page details field by field', async () => {
    const result = await updateOrganizationBranding({}, form({ tagline: 'x'.repeat(161), companySize: 'huge', specialties: 'A' }))
    expect(result.fieldErrors?.tagline?.[0]).toBe('Keep the tagline to 160 characters or fewer.')
    expect(result.fieldErrors?.companySize?.[0]).toBe('Choose a company size from the list.')
    expect(result.fieldErrors?.specialties?.[0]).toBe('Enter each speciality using at least 2 characters.')
    expect(mocks.updateBranding).not.toHaveBeenCalled()
  })

  it('uploads a new cover image, stores its path and removes the old one', async () => {
    const result = await updateOrganizationBranding({}, form({ tagline: '', cover: image('cover.webp', 'image/webp') }))
    expect(result).toEqual({ success: true })
    const key = mocks.putMediaObject.mock.calls[0]?.[0]?.key as string
    expect(key).toMatch(new RegExp(`^organizations/${companyId}/cover-[0-9a-f-]+\\.webp$`))
    expect(mocks.updateCoverPath).toHaveBeenCalledWith(companyId, key)
    expect(mocks.deleteMediaObject).toHaveBeenCalledWith('organizations/old-cover.jpg')
    expect(mocks.updateBranding).toHaveBeenCalledWith(companyId, expect.objectContaining({ tagline: null }))
  })

  it('removes the cover image when asked', async () => {
    await updateOrganizationBranding({}, form({ removeCover: 'on' }))
    expect(mocks.updateCoverPath).toHaveBeenCalledWith(companyId, null)
    expect(mocks.deleteMediaObject).toHaveBeenCalledWith('organizations/old-cover.jpg')
    expect(mocks.putMediaObject).not.toHaveBeenCalled()
  })

  it('rejects covers that are not images or are too large, before uploading anything', async () => {
    const wrongType = await updateOrganizationBranding({}, form({ cover: image('cover.gif', 'image/gif') }))
    expect(wrongType.error).toBe('Cover image must be a JPG, PNG or WebP image up to 5 MB.')
    const tooLarge = await updateOrganizationBranding({}, form({ cover: image('cover.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1) }))
    expect(tooLarge.error).toBe('Cover image must be a JPG, PNG or WebP image up to 5 MB.')
    expect(mocks.putMediaObject).not.toHaveBeenCalled()
  })

  it('deletes freshly uploaded images when saving fails, and keeps the form contents', async () => {
    mocks.updateBranding.mockRejectedValue(new Error('db down'))
    const result = await updateOrganizationBranding({}, form({ logo: image('logo.png', 'image/png'), cover: image('cover.jpg') }))
    expect(result.error).toBe('We could not update the organization workspace. Your entered information is still here.')
    expect(mocks.putMediaObject).toHaveBeenCalledTimes(2)
    const uploaded = mocks.putMediaObject.mock.calls.map((call) => call[0].key)
    expect(mocks.deleteMediaObject.mock.calls.map((call) => call[0]).sort()).toEqual([...uploaded].sort())
    expect(mocks.updateCoverPath).not.toHaveBeenCalled()
  })

  it('keeps stored page details when an older form does not send them', async () => {
    const data = form({})
    await updateOrganizationBranding({}, data)
    const input = mocks.updateBranding.mock.calls[0]?.[1]
    expect(input).not.toHaveProperty('tagline')
    expect(input).not.toHaveProperty('companySize')
    expect(mocks.updateCoverPath).not.toHaveBeenCalled()
  })
})
