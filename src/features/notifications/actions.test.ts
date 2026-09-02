import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { markAllNotificationsRead, markNotificationRead } from './actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/queries', () => ({
  requireUser: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))

const mockedCreateServerSupabaseClient = vi.mocked(createServerSupabaseClient)

describe('notification actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an invalid notification id before creating Supabase', async () => {
    expect(await markNotificationRead('not-a-uuid')).toEqual({ ok: false, error: 'Invalid notification.' })
    expect(mockedCreateServerSupabaseClient).not.toHaveBeenCalled()
  })

  it('marks only the signed-in recipient notification as read', async () => {
    const recipientEq = vi.fn(async () => ({ error: null }))
    const idEq = vi.fn(() => ({ eq: recipientEq }))
    const update = vi.fn(() => ({ eq: idEq }))
    mockedCreateServerSupabaseClient.mockResolvedValue({ from: vi.fn(() => ({ update })) } as never)

    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    expect(await markNotificationRead(id)).toEqual({ ok: true })
    expect(idEq).toHaveBeenCalledWith('id', id)
    expect(recipientEq).toHaveBeenCalledWith('recipient_id', '11111111-1111-4111-8111-111111111111')
  })

  it('marks only unread notifications belonging to the signed-in recipient', async () => {
    const isUnread = vi.fn(async () => ({ error: null }))
    const recipientEq = vi.fn(() => ({ is: isUnread }))
    const update = vi.fn(() => ({ eq: recipientEq }))
    mockedCreateServerSupabaseClient.mockResolvedValue({ from: vi.fn(() => ({ update })) } as never)

    expect(await markAllNotificationsRead()).toEqual({ ok: true })
    expect(recipientEq).toHaveBeenCalledWith('recipient_id', '11111111-1111-4111-8111-111111111111')
    expect(isUnread).toHaveBeenCalledWith('read_at', null)
  })
})
