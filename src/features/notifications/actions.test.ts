import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { deleteNotification, markAllNotificationsRead, markNotificationRead } from './actions'
import {
  deleteNotificationInAurora,
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
vi.mock('./queries', () => ({
  getNotificationChrome: vi.fn(),
  getNotifications: vi.fn(),
}))
vi.mock('./repository', () => ({
  markNotificationReadInAurora: vi.fn(async () => true),
  markAllNotificationsReadInAurora: vi.fn(async () => undefined),
  deleteNotificationInAurora: vi.fn(async () => true),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const NOTIFICATION_ID = '22222222-2222-4222-8222-222222222222'

const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedMarkRead = vi.mocked(markNotificationReadInAurora)
const mockedMarkAllRead = vi.mocked(markAllNotificationsReadInAurora)
const mockedRevalidatePath = vi.mocked(revalidatePath)
const mockedDelete = vi.mocked(deleteNotificationInAurora)

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
    mockedDelete.mockResolvedValue(true)
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
      error: 'This notification is no longer available. Refresh the page to see your latest notifications.',
    })
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })

  it('returns a sign-in message instead of throwing when the session has expired', async () => {
    const expired = Object.assign(new Error('Authentication required.'), { name: 'AwsAuthenticationRequiredError' })
    mockedRequireAwsUser.mockRejectedValueOnce(expired)
    await expect(markNotificationRead(NOTIFICATION_ID)).resolves.toEqual({
      ok: false,
      error: 'Your session has expired. Sign in again, then retry.',
    })
    mockedRequireAwsUser.mockRejectedValueOnce(expired)
    await expect(markAllNotificationsRead()).resolves.toEqual({
      ok: false,
      error: 'Your session has expired. Sign in again, then retry.',
    })
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

  describe('deleteNotification', () => {
    it('rejects invalid ids before authentication or persistence', async () => {
      await expect(deleteNotification('nope')).resolves.toEqual({ ok: false, error: 'Invalid notification.' })
      expect(mockedRequireAwsUser).not.toHaveBeenCalled()
      expect(mockedDelete).not.toHaveBeenCalled()
    })

    it('deletes only for the signed-in recipient (permanent profile UUID) and revalidates', async () => {
      await expect(deleteNotification(NOTIFICATION_ID)).resolves.toEqual({ ok: true })
      expect(mockedDelete).toHaveBeenCalledTimes(1)
      expect(mockedDelete).toHaveBeenCalledWith(USER_ID, NOTIFICATION_ID)
      expect(mockedRevalidatePath).toHaveBeenCalledWith('/notifications')
    })

    it("fails closed for someone else's notification (nothing deleted for this recipient)", async () => {
      mockedDelete.mockResolvedValue(false)
      await expect(deleteNotification(NOTIFICATION_ID)).resolves.toEqual({
        ok: false,
        error: 'This notification is no longer available. Refresh the page to see your latest notifications.',
      })
      expect(mockedRevalidatePath).not.toHaveBeenCalled()
    })

    it('requires a signed-in member', async () => {
      const expired = Object.assign(new Error('Authentication required.'), { name: 'AwsAuthenticationRequiredError' })
      mockedRequireAwsUser.mockRejectedValueOnce(expired)
      await expect(deleteNotification(NOTIFICATION_ID)).resolves.toEqual({
        ok: false,
        error: 'Your session has expired. Sign in again, then retry.',
      })
      expect(mockedDelete).not.toHaveBeenCalled()
    })
  })
})
