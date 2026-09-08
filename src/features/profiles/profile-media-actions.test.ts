import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { removeProfileMedia, uploadProfileMedia } from './profile-media-service'
import {
  removeAvatarAction,
  removeCoverAction,
  uploadAvatarAction,
  uploadCoverAction,
} from './profile-media-actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    cognitoSub: 'sub',
    email: 'member@example.com',
  })),
}))
vi.mock('./profile-media-service', () => ({
  uploadProfileMedia: vi.fn(async () => 'profiles/member/avatar.jpg'),
  removeProfileMedia: vi.fn(async () => undefined),
}))

const profileId = '11111111-1111-4111-8111-111111111111'
const mockedRevalidatePath = vi.mocked(revalidatePath)
const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedUpload = vi.mocked(uploadProfileMedia)
const mockedRemove = vi.mocked(removeProfileMedia)

function imageForm() {
  const data = new FormData()
  const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('photo').buffer,
  })
  data.set('image', file)
  return data
}

function expectProfileMediaRevalidation() {
  expect(mockedRevalidatePath).toHaveBeenCalledWith('/profile')
  expect(mockedRevalidatePath).toHaveBeenCalledWith('/people/[slug]', 'page')
  expect(mockedRevalidatePath).toHaveBeenCalledWith('/home')
  expect(mockedRevalidatePath).toHaveBeenCalledWith('/network')
}

describe('profile media actions', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['avatar', uploadAvatarAction],
    ['cover', uploadCoverAction],
  ] as const)('persists %s upload and invalidates every place that can display profile media', async (kind, action) => {
    await expect(action({}, imageForm())).resolves.toEqual({ success: true })

    expect(mockedRequireAwsUser).toHaveBeenCalledTimes(1)
    expect(mockedUpload).toHaveBeenCalledWith(profileId, kind, expect.objectContaining({
      type: 'image/jpeg',
      size: 5,
      bytes: expect.any(Uint8Array),
    }))
    expectProfileMediaRevalidation()
  })

  it.each([
    ['avatar', removeAvatarAction],
    ['cover', removeCoverAction],
  ] as const)('returns success after removing %s and invalidates every place that can display profile media', async (kind, action) => {
    await expect(action(new FormData())).resolves.toEqual({ success: true })

    expect(mockedRemove).toHaveBeenCalledWith(profileId, kind)
    expectProfileMediaRevalidation()
  })
})
