import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  moderateContent: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({
  AwsAuthenticationRequiredError: class AwsAuthenticationRequiredError extends Error {},
}))
vi.mock('@/features/admin/access', () => ({
  requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser,
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
    mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
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

  it('validates destructive actions only after administrator access is confirmed', async () => {
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
    expect(mocks.requirePlatformAdministratorUser).toHaveBeenCalledTimes(1)
  })

  it('rejects a normal authenticated user before any moderation mutation runs', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new Error('admin_forbidden'))

    const response = await POST(request({
      targetType: 'post',
      targetId,
      action: 'resolve',
      note: 'Attempted admin operation.',
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'You do not have permission to moderate platform content.',
    })
    expect(mocks.moderateContent).not.toHaveBeenCalled()
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
