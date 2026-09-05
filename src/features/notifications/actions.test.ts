import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { markAllNotificationsRead, markNotificationRead } from './actions'
import {
  markAllNotificationsReadInAurora,
  markNotificationReadInAurora,
} from './repository'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    cognitoSub: 'cognito-sub-123',
    email: 'member@example.com',
  })),
}))
vi.mock('./repository', () => ({
  markNotificationReadInAurora: vi.fn(async () => true),
  markAllNotificationsReadInAurora: vi.fn(async () => undefined),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const NOTIFICATION_ID = '22222222-2222-4222-8222-222222222222'

const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedMarkRead = vi.mocked(markNotificationReadInAurora)
const mockedMarkAllRead = vi.mocked(markAllNotificationsReadInAurora)
const mockedRevalidatePath = vi.mocked(revalidatePath)

describe('Aurora notification actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedRequireAwsUser.mockResolvedValue({
      id: USER_ID,
      cognitoSub: 'cognito-sub-123',
      email: 'member@example.com',
    })
    mockedMarkRead.mockResolvedValue(true)
    mockedMarkAllRead.mockResolvedValue(undefined)
  })

  it('rejects invalid notification ids before authentication or persistence', async () => {
    await expect(markNotificationRead('not-a-uuid')).resolves.toEqual({
      ok: false,
      error: 'Invalid notification.',
    })
    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedMarkRead).not.toHaveBeenCalled()
  })

  it('marks one notification read using the permanent profile UUID', async () => {
    await expect(markNotificationRead(NOTIFICATION_ID)).resolves.toEqual({ ok: true })
    expect(mockedMarkRead).toHaveBeenCalledWith(USER_ID, NOTIFICATION_ID)
    expect(mockedMarkRead).not.toHaveBeenCalledWith('cognito-sub-123', NOTIFICATION_ID)
  })

  it('fails closed when the notification is not owned by the authenticated recipient', async () => {
    mockedMarkRead.mockResolvedValue(false)

    await expect(markNotificationRead(NOTIFICATION_ID)).resolves.toEqual({
      ok: false,
      error: 'We could not update this notification.',
    })
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })

  it('marks all notifications read only for the permanent recipient UUID', async () => {
    await expect(markAllNotificationsRead()).resolves.toEqual({ ok: true })
    expect(mockedMarkAllRead).toHaveBeenCalledWith(USER_ID)
  })

  it('preserves notification surface revalidation after successful writes', async () => {
    await markNotificationRead(NOTIFICATION_ID)

    expect(mockedRevalidatePath).toHaveBeenCalledWith('/notifications')
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/home')
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/network')
  })
})
