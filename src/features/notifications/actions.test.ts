import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  deleteNotification,
  deleteNotifications,
  loadNotificationChrome,
  loadUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsRead,
} from './actions'
import { getNotificationChrome, getUnreadNotificationCount } from './queries'
import {
  deleteNotificationInAurora,
  deleteNotificationsInAurora,
  markAllNotificationsReadInAurora,
  markNotificationReadInAurora,
  markNotificationsReadInAurora,
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
  getUnreadNotificationCount: vi.fn(),
}))
vi.mock('./repository', () => ({
  markNotificationReadInAurora: vi.fn(async () => true),
  markAllNotificationsReadInAurora: vi.fn(async () => undefined),
  deleteNotificationInAurora: vi.fn(async () => true),
  markNotificationsReadInAurora: vi.fn(async () => 0),
  deleteNotificationsInAurora: vi.fn(async () => 0),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const NOTIFICATION_ID = '22222222-2222-4222-8222-222222222222'

const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedMarkRead = vi.mocked(markNotificationReadInAurora)
const mockedMarkAllRead = vi.mocked(markAllNotificationsReadInAurora)
const mockedRevalidatePath = vi.mocked(revalidatePath)
const mockedDelete = vi.mocked(deleteNotificationInAurora)
const mockedMarkManyRead = vi.mocked(markNotificationsReadInAurora)
const mockedDeleteMany = vi.mocked(deleteNotificationsInAurora)
const SECOND_ID = '33333333-3333-4333-8333-333333333333'

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
    mockedMarkManyRead.mockImplementation(async (_recipient, ids) => ids.length)
    mockedDeleteMany.mockImplementation(async (_recipient, ids) => ids.length)
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

  // Round DB: a grouped row is one sign-in check, one statement and one revalidation, not one action per id.
  describe.each([
    ['markNotificationsRead', markNotificationsRead, mockedMarkManyRead],
    ['deleteNotifications', deleteNotifications, mockedDeleteMany],
  ] as const)('%s (grouped rows)', (_name, action, batch) => {
    it('rejects an empty, oversized or invalid id list before authentication or persistence', async () => {
      const tooMany = Array.from({ length: 51 }, () => NOTIFICATION_ID)
      for (const ids of [[], tooMany, [NOTIFICATION_ID, 'not-a-uuid']]) {
        await expect(action(ids)).resolves.toEqual({ ok: false, error: 'Invalid notification.' })
      }
      await expect(action('nope' as unknown as string[])).resolves.toEqual({ ok: false, error: 'Invalid notification.' })
      expect(mockedRequireAwsUser).not.toHaveBeenCalled()
      expect(batch).not.toHaveBeenCalled()
    })

    it('runs one statement for the signed-in recipient with the distinct ids, and revalidates once', async () => {
      await expect(action([NOTIFICATION_ID, SECOND_ID, NOTIFICATION_ID])).resolves.toEqual({ ok: true })
      expect(mockedRequireAwsUser).toHaveBeenCalledTimes(1)
      expect(batch).toHaveBeenCalledTimes(1)
      expect(batch).toHaveBeenCalledWith(USER_ID, [NOTIFICATION_ID, SECOND_ID])
      expect(mockedMarkRead).not.toHaveBeenCalled()
      expect(mockedDelete).not.toHaveBeenCalled()
      expect(mockedRevalidatePath).toHaveBeenCalledTimes(3)
      expect(mockedRevalidatePath).toHaveBeenCalledWith('/notifications')
      expect(mockedRevalidatePath).toHaveBeenCalledWith('/home')
      expect(mockedRevalidatePath).toHaveBeenCalledWith('/network')
    })

    it('fails closed when any id is not the recipient\'s, without revalidating when nothing changed', async () => {
      batch.mockResolvedValueOnce(0)
      await expect(action([NOTIFICATION_ID, SECOND_ID])).resolves.toEqual({
        ok: false,
        error: 'This notification is no longer available. Refresh the page to see your latest notifications.',
      })
      expect(mockedRevalidatePath).not.toHaveBeenCalled()
    })

    it('reports the same error but refreshes the surfaces when only some ids were found', async () => {
      batch.mockResolvedValueOnce(1)
      await expect(action([NOTIFICATION_ID, SECOND_ID])).resolves.toEqual({
        ok: false,
        error: 'This notification is no longer available. Refresh the page to see your latest notifications.',
      })
      expect(mockedRevalidatePath).toHaveBeenCalledWith('/notifications')
    })

    it('requires a signed-in member', async () => {
      const expired = Object.assign(new Error('Authentication required.'), { name: 'AwsAuthenticationRequiredError' })
      mockedRequireAwsUser.mockRejectedValueOnce(expired)
      await expect(action([NOTIFICATION_ID])).resolves.toEqual({
        ok: false,
        error: 'Your session has expired. Sign in again, then retry.',
      })
      expect(batch).not.toHaveBeenCalled()
    })
  })
})

describe('notification bell loading actions (Round 14, 3.9)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns only the unread count for the closed bell', async () => {
    vi.mocked(getUnreadNotificationCount).mockResolvedValueOnce(5)
    await expect(loadUnreadNotificationCount()).resolves.toEqual({ ok: true, unreadCount: 5 })
    expect(getNotificationChrome).not.toHaveBeenCalled()
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })

  it('keeps the last badge when the count cannot be read', async () => {
    vi.mocked(getUnreadNotificationCount).mockRejectedValueOnce(new Error('timeout'))
    await expect(loadUnreadNotificationCount()).resolves.toEqual({
      ok: false,
      error: 'We could not refresh your notifications. They will update again shortly.',
    })
  })

  it('loads the recent list and count when the panel opens', async () => {
    const chrome = { recent: [], unreadCount: 2 }
    vi.mocked(getNotificationChrome).mockResolvedValueOnce(chrome)
    await expect(loadNotificationChrome()).resolves.toEqual({ ok: true, chrome })
    expect(mockedRevalidatePath).not.toHaveBeenCalled()
  })
})
