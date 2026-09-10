import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    cognitoSub: 'cognito-subject',
    email: 'viewer@example.com',
  })),
  loadReactionDetails: vi.fn(async () => ({ reactors: [], nextCursor: null })),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: mocks.requireAwsUser,
  getAwsVerifiedUser: mocks.requireAwsUser,
}))
vi.mock('./media', () => ({
  resolveFeedMediaUrls: vi.fn(async () => new Map()),
  createPendingPostMediaUpload: vi.fn(),
  verifyPendingPostMedia: vi.fn(),
  removeFeedImage: vi.fn(),
}))
vi.mock('./queries', () => ({ getFeedPage: vi.fn() }))
vi.mock('./service', () => ({
  createStandardPostWithAurora: vi.fn(),
  assertPendingMediaDiscardableWithAurora: vi.fn(),
  createPollPostWithAurora: vi.fn(),
  deletePostWithAurora: vi.fn(),
  setPostLikedWithAurora: vi.fn(),
  setPostReactionWithAurora: vi.fn(),
  setPostSavedWithAurora: vi.fn(),
  addPostCommentWithAurora: vi.fn(),
  setCommentReactionWithAurora: vi.fn(),
  setPollVoteWithAurora: vi.fn(),
  loadReactionDetailsWithAurora: mocks.loadReactionDetails,
}))

type LoadReactionDetails = (input: {
  targetType: 'post' | 'comment'
  targetId: string
  reaction?: 'like' | 'support' | 'respect' | 'on_point'
  cursor?: string
  limit?: number
}) => Promise<{ ok: true; page: { reactors: unknown[]; nextCursor: string | null } } | { ok: false; error: string }>

async function actionUnderTest() {
  const actions = await import('./actions') as unknown as { loadReactionDetails?: LoadReactionDetails }
  expect(actions.loadReactionDetails).toBeTypeOf('function')
  return actions.loadReactionDetails
}

describe('loadReactionDetails action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadReactionDetails.mockResolvedValue({ reactors: [], nextCursor: null })
  })

  it('rejects invalid target and reaction input before authentication', async () => {
    const action = await actionUnderTest()
    if (!action) return

    await expect(action({ targetType: 'post', targetId: 'not-a-uuid', reaction: 'support' })).resolves.toEqual({
      ok: false,
      error: 'Invalid reaction request.',
    })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.loadReactionDetails).not.toHaveBeenCalled()
  })

  it('authenticates and lazily delegates a canonical request to Aurora', async () => {
    const action = await actionUnderTest()
    if (!action) return
    const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

    await expect(action({ targetType: 'comment', targetId, reaction: 'respect' })).resolves.toEqual({
      ok: true,
      page: { reactors: [], nextCursor: null },
    })
    expect(mocks.loadReactionDetails).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      { targetType: 'comment', targetId, reaction: 'respect', limit: 30 },
    )
  })

  it('returns safe copy when the lazy Aurora read fails', async () => {
    mocks.loadReactionDetails.mockRejectedValueOnce(new Error('database connection secret'))
    const action = await actionUnderTest()
    if (!action) return

    await expect(action({
      targetType: 'post',
      targetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })).resolves.toEqual({ ok: false, error: 'We could not load reactions.' })
  })
})
