import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  acceptConnectionRequest,
  followProfile,
  sendConnectionRequest,
} from './actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/queries', () => ({
  requireUser: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))

const mockedCreateServerSupabaseClient = vi.mocked(createServerSupabaseClient)

describe('network actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects invalid profile ids before Supabase is created', async () => {
    expect(await followProfile('not-a-uuid')).toEqual({
      ok: false,
      error: 'Invalid member.',
    })
    expect(mockedCreateServerSupabaseClient).not.toHaveBeenCalled()
  })

  it('calls the exact follow RPC argument', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }))
    mockedCreateServerSupabaseClient.mockResolvedValue({ rpc } as never)

    const targetId = '22222222-2222-4222-8222-222222222222'
    expect(await followProfile(targetId)).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('follow_profile', { p_target_id: targetId })
  })

  it('calls the exact send-request RPC argument', async () => {
    const rpc = vi.fn(async () => ({ data: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', error: null }))
    mockedCreateServerSupabaseClient.mockResolvedValue({ rpc } as never)

    const targetId = '22222222-2222-4222-8222-222222222222'
    expect(await sendConnectionRequest(targetId)).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('send_connection_request', { p_target_id: targetId })
  })

  it('rejects invalid connection ids before Supabase is created', async () => {
    expect(await acceptConnectionRequest('not-a-uuid')).toEqual({
      ok: false,
      error: 'Invalid connection request.',
    })
    expect(mockedCreateServerSupabaseClient).not.toHaveBeenCalled()
  })

  it('calls the exact accept RPC argument', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }))
    mockedCreateServerSupabaseClient.mockResolvedValue({ rpc } as never)

    const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    expect(await acceptConnectionRequest(connectionId)).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('accept_connection_request', { p_connection_id: connectionId })
  })

  it.each([
    ['network_request_exists', 'Request already sent.'],
    ['network_already_connected', 'You’re already connected.'],
    ['network_interaction_unavailable', 'This interaction is not available.'],
    ['network_action_not_allowed', 'This interaction is not available.'],
    ['network_self_interaction', 'You cannot perform this action on your own profile.'],
  ])('maps %s to safe copy', async (message, expected) => {
    const rpc = vi.fn(async () => ({ data: null, error: { message } }))
    mockedCreateServerSupabaseClient.mockResolvedValue({ rpc } as never)

    const result = await followProfile('22222222-2222-4222-8222-222222222222')
    expect(result).toEqual({ ok: false, error: expected })
  })
})
