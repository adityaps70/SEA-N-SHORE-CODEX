import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  requireCapability: vi.fn(),
  getById: vi.fn(),
  updateBranding: vi.fn(),
  updateLogoPath: vi.fn(),
  updateCoverPath: vi.fn(),
  createMediaUploadUrl: vi.fn(),
  headMediaObject: vi.fn(),
  deleteMediaObject: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ requireCapability: mocks.requireCapability }))
const verifyUpload = vi.hoisted(() => ({
  verifyStoredUploadSignature: vi.fn<(key: string, mimeType: string, size: number) => Promise<'match' | 'mismatch' | 'unavailable'>>(async () => 'match'),
}))
vi.mock('@/lib/uploads/verify-stored-upload', () => verifyUpload)
vi.mock('@/lib/aws/storage', () => ({ createMediaUploadUrl: mocks.createMediaUploadUrl, headMediaObject: mocks.headMediaObject, deleteMediaObject: mocks.deleteMediaObject }))
vi.mock('./workspace-repository', () => ({
  organizationWorkspaceRepository: {
    getById: mocks.getById,
    updateBranding: mocks.updateBranding,
    updateLogoPath: mocks.updateLogoPath,
    updateCoverPath: mocks.updateCoverPath,
  },
}))

import { updateOrganizationBranding, requestOrganizationMediaUploadAction, completeOrganizationMediaUploadAction } from './workspace-actions'

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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.requireCapability.mockResolvedValue(undefined)
  mocks.getById.mockResolvedValue({ id: companyId, slug: 'oceanic', organizationType: 'ship_manager', logoPath: null, coverPath: 'organizations/old-cover.jpg' })
  mocks.updateBranding.mockResolvedValue(true)
  mocks.updateLogoPath.mockResolvedValue(true)
  mocks.updateCoverPath.mockResolvedValue(true)
  mocks.createMediaUploadUrl.mockResolvedValue('https://s3.example/signed')
  mocks.headMediaObject.mockResolvedValue({ contentType: 'image/webp', contentLength: 1234 })
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

  it('issues authenticated size-bound ticket and finalizes a verified organization cover', async () => {
    const ticket = await requestOrganizationMediaUploadAction({ companyId, kind: 'cover', contentType: 'image/webp', size: 1234 })
    expect(ticket.success).toBe(true)
    expect(mocks.createMediaUploadUrl).toHaveBeenCalledWith({ key: ticket.key, contentType: 'image/webp', contentLength: 1234 })
    const result = await completeOrganizationMediaUploadAction({ companyId, kind: 'cover', key: ticket.key! })
    expect(result).toEqual({ success: true })
    expect(mocks.updateCoverPath).toHaveBeenCalledWith(companyId, ticket.key)
    expect(mocks.deleteMediaObject).toHaveBeenCalledWith('organizations/old-cover.jpg')
  })

  it('deletes an upload whose bytes are not a real image instead of attaching it (Round P3)', async () => {
    const ticket = await requestOrganizationMediaUploadAction({ companyId, kind: 'cover', contentType: 'image/webp', size: 1234 })
    verifyUpload.verifyStoredUploadSignature.mockResolvedValueOnce('mismatch')
    const result = await completeOrganizationMediaUploadAction({ companyId, kind: 'cover', key: ticket.key! })
    expect(result).toEqual({ error: 'This file is not a real JPG, PNG or WebP image. Choose another image.' })
    expect(mocks.deleteMediaObject).toHaveBeenCalledWith(ticket.key)
    expect(mocks.updateCoverPath).not.toHaveBeenCalled()
  })

  it('removes the cover image when asked', async () => {
    await updateOrganizationBranding({}, form({ removeCover: 'on' }))
    expect(mocks.updateCoverPath).toHaveBeenCalledWith(companyId, null)
    expect(mocks.deleteMediaObject).toHaveBeenCalledWith('organizations/old-cover.jpg')

  })

  it('rejects oversize and unsupported image tickets before S3', async () => {
    expect((await requestOrganizationMediaUploadAction({ companyId, kind: 'cover', contentType: 'image/gif', size: 2 })).error).toMatch(/5 MB/)
    expect((await requestOrganizationMediaUploadAction({ companyId, kind: 'cover', contentType: 'image/webp', size: 5 * 1024 * 1024 + 1 })).error).toMatch(/5 MB/)
    expect(mocks.createMediaUploadUrl).not.toHaveBeenCalled()
  })

  it('does not replace branding paths for invalid S3 objects', async () => {
    mocks.headMediaObject.mockResolvedValueOnce({ contentType: 'image/gif', contentLength: 100 })
    const result = await completeOrganizationMediaUploadAction({
      companyId, kind: 'cover', key: `organizations/${companyId}/cover-abcd.webp`,
    })
    expect(result.success).not.toBe(true)
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
