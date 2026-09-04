import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  acceptConnectionRequestWithAurora,
  followProfileWithAurora,
  sendConnectionRequestWithAurora,
} from './service'
import {
  acceptConnectionRequest,
  followProfile,
  sendConnectionRequest,
} from './actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    cognitoSub: 'cognito-sub-1',
    email: 'member@example.com',
  })),
}))
vi.mock('./service', () => ({
  followProfileWithAurora: vi.fn(async () => true),
  unfollowProfileWithAurora: vi.fn(async () => true),
  sendConnectionRequestWithAurora: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  cancelConnectionRequestWithAurora: vi.fn(async () => true),
  acceptConnectionRequestWithAurora: vi.fn(async () => true),
  declineConnectionRequestWithAurora: vi.fn(async () => true),
  removeConnectionWithAurora: vi.fn(async () => true),
  blockProfileWithAurora: vi.fn(async () => true),
  unblockProfileWithAurora: vi.fn(async () => true),
}))

const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedFollow = vi.mocked(followProfileWithAurora)
const mockedSendRequest = vi.mocked(sendConnectionRequestWithAurora)
const mockedAccept = vi.mocked(acceptConnectionRequestWithAurora)

const viewerId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'
const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('network actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedRequireAwsUser.mockResolvedValue({
      id: viewerId,
      cognitoSub: 'cognito-sub-1',
      email: 'member@example.com',
    })
    mockedFollow.mockResolvedValue(true)
    mockedSendRequest.mockResolvedValue(connectionId)
    mockedAccept.mockResolvedValue(true)
  })

  it('rejects invalid profile ids before resolving AWS identity or calling the service', async () => {
    expect(await followProfile('not-a-uuid')).toEqual({
      ok: false,
      error: 'Invalid member.',
    })
    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedFollow).not.toHaveBeenCalled()
  })

  it('calls follow with the permanent viewer profile UUID and target UUID', async () => {
    expect(await followProfile(targetId)).toEqual({ ok: true })
    expect(mockedFollow).toHaveBeenCalledWith(viewerId, targetId)
  })

  it('calls send-request with the permanent viewer profile UUID and target UUID', async () => {
    expect(await sendConnectionRequest(targetId)).toEqual({ ok: true })
    expect(mockedSendRequest).toHaveBeenCalledWith(viewerId, targetId)
  })

  it('rejects invalid connection ids before resolving AWS identity or calling the service', async () => {
    expect(await acceptConnectionRequest('not-a-uuid')).toEqual({
      ok: false,
      error: 'Invalid connection request.',
    })
    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedAccept).not.toHaveBeenCalled()
  })

  it('calls accept with the permanent viewer profile UUID and connection UUID', async () => {
    expect(await acceptConnectionRequest(connectionId)).toEqual({ ok: true })
    expect(mockedAccept).toHaveBeenCalledWith(viewerId, connectionId)
  })

  it.each([
    ['network_request_exists', 'Request already sent.'],
    ['network_already_connected', 'You’re already connected.'],
    ['network_interaction_unavailable', 'This interaction is not available.'],
    ['network_action_not_allowed', 'This interaction is not available.'],
    ['network_self_interaction', 'You cannot perform this action on your own profile.'],
  ])('maps %s to safe copy', async (message, expected) => {
    mockedFollow.mockRejectedValueOnce(new Error(message))

    const result = await followProfile(targetId)
    expect(result).toEqual({ ok: false, error: expected })
  })
})
