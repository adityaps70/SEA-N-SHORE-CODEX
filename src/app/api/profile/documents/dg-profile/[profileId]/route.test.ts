import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  createDownload: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/profiles/profile-document-service', () => ({
  createDgProfileDownloadForViewer: mocks.createDownload,
}))

import { GET } from './route'

const ownerId = '11111111-1111-4111-8111-111111111111'

function call(profileId = ownerId) {
  return GET(new Request(`https://example.test/api/profile/documents/dg-profile/${profileId}`), {
    params: Promise.resolve({ profileId }),
  })
}

beforeEach(() => {
  mocks.getVerifiedUser.mockReset()
  mocks.createDownload.mockReset()
})

describe('DG profile download route', () => {
  it('asks signed-out visitors to sign in and never looks up the document', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    const response = await call()
    expect(response.status).toBe(401)
    expect(await response.text()).toMatch(/sign in/i)
    expect(mocks.createDownload).not.toHaveBeenCalled()
  })

  it.each([
    ['owner', ownerId],
    ['employer', '22222222-2222-4222-8222-222222222222'],
    ['admin', '44444444-4444-4444-8444-444444444444'],
  ])('redirects an authorised %s to a short-lived signed URL without caching it', async (reason, viewerId) => {
    mocks.getVerifiedUser.mockResolvedValue({ id: viewerId })
    mocks.createDownload.mockResolvedValue({ status: 'ok', url: 'https://bucket.example/signed?X-Amz-Expires=60', reason })

    const response = await call()

    expect(mocks.createDownload).toHaveBeenCalledWith(viewerId, ownerId)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://bucket.example/signed?X-Amz-Expires=60')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it.each([
    ['an employer without an application'],
    ['a stranger'],
  ])('answers %s with the same not-available response used for missing documents', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' })
    mocks.createDownload.mockResolvedValue({ status: 'unavailable' })

    const response = await call()

    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toBe('This document is not available.')
  })

  it('rejects malformed profile ids before any lookup', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: ownerId })
    const response = await call('../../etc/passwd')
    expect(response.status).toBe(404)
    expect(mocks.createDownload).not.toHaveBeenCalled()
  })

  it('explains a temporary storage failure plainly', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: ownerId })
    mocks.createDownload.mockRejectedValue(new Error('aws_media_bucket_missing'))
    const response = await call()
    expect(response.status).toBe(503)
    expect(await response.text()).toMatch(/try again/i)
  })
})
