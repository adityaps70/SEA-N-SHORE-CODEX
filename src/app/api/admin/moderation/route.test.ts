import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  moderateContent: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: mocks.requireAwsUser,
  AwsAuthenticationRequiredError: class AwsAuthenticationRequiredError extends Error {},
}))
vi.mock('@/features/admin/repository', () => ({
  adminRepository: { moderateContent: mocks.moderateContent },
}))

import { POST } from './route'

const targetId = '22222222-2222-4222-8222-222222222222'

function request(body: unknown) {
  return new Request('https://d3prih0q6jofyr.cloudfront.net/api/admin/moderation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/moderation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1' })
    mocks.moderateContent.mockResolvedValue(true)
  })

  it('runs moderation for the authenticated administrator and returns no-store JSON', async () => {
    const response = await POST(request({
      targetType: 'post',
      targetId,
      action: 'resolve',
      note: 'Reviewed against platform rules.',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.moderateContent).toHaveBeenCalledWith('admin-1', {
      targetType: 'post',
      targetId,
      action: 'resolve',
      note: 'Reviewed against platform rules.',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/moderation')
  })

  it('rejects destructive actions without a moderator note before touching auth', async () => {
    const response = await POST(request({
      targetType: 'job',
      targetId,
      action: 'remove',
      note: ' ',
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Add a moderation note for this action.',
    })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
  })

  it('returns a useful error response when moderation cannot be saved', async () => {
    mocks.moderateContent.mockRejectedValueOnce(new Error('moderation_case_not_found'))

    const response = await POST(request({
      targetType: 'event',
      targetId,
      action: 'dismiss',
      note: 'No violation found.',
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'This moderation case could not be found.',
    })
  })
})
