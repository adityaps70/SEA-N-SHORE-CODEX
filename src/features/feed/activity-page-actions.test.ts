import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMyActivityPosts, getMyCommentActivity } from './queries'
import { loadMyActivityPostsPage, loadMyCommentActivityPage } from './actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: vi.fn() }))
vi.mock('./media', () => ({
  createPendingPostMediaUpload: vi.fn(),
  removeFeedImage: vi.fn(),
  verifyPendingPostMedia: vi.fn(),
}))
vi.mock('./queries', () => ({
  getFeedPage: vi.fn(),
  getPostById: vi.fn(),
  getMyActivityPosts: vi.fn(),
  getMyCommentActivity: vi.fn(),
}))
vi.mock('./service', () => ({}))

const cursor = { createdAt: '2026-09-05T07:00:00.123456Z', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const page = { entries: [], nextCursor: null }

beforeEach(() => {
  vi.mocked(getMyActivityPosts).mockReset()
  vi.mocked(getMyCommentActivity).mockReset()
})

describe('My Activities load-more actions (Round 14, 3.7)', () => {
  it('loads the next page of the member own posts from a valid cursor', async () => {
    vi.mocked(getMyActivityPosts).mockResolvedValueOnce(page)
    await expect(loadMyActivityPostsPage({ cursor })).resolves.toEqual({ ok: true, page })
    expect(getMyActivityPosts).toHaveBeenCalledWith(cursor)
  })

  it('loads the next page of comment activity from a valid cursor', async () => {
    vi.mocked(getMyCommentActivity).mockResolvedValueOnce(page)
    await expect(loadMyCommentActivityPage({ cursor })).resolves.toEqual({ ok: true, page })
    expect(getMyCommentActivity).toHaveBeenCalledWith(cursor)
  })

  it.each([
    ['a missing cursor', undefined],
    ['a cursor without a timestamp', { id: cursor.id }],
    ['a rounded Date instead of exact text', { createdAt: new Date('2026-09-05T07:00:00.123Z'), id: cursor.id }],
    ['a non-UUID id', { createdAt: cursor.createdAt, id: '1 or 1=1' }],
  ])('rejects %s without querying', async (_label, bad) => {
    await expect(loadMyActivityPostsPage({ cursor: bad } as never)).resolves.toEqual({ ok: false, error: 'The next page request was invalid.' })
    await expect(loadMyCommentActivityPage({ cursor: bad } as never)).resolves.toEqual({ ok: false, error: 'The next page request was invalid.' })
    expect(getMyActivityPosts).not.toHaveBeenCalled()
    expect(getMyCommentActivity).not.toHaveBeenCalled()
  })

  it('returns a friendly error when the page cannot be loaded', async () => {
    vi.mocked(getMyActivityPosts).mockRejectedValueOnce(new Error('timeout'))
    vi.mocked(getMyCommentActivity).mockRejectedValueOnce(new Error('timeout'))
    await expect(loadMyActivityPostsPage({ cursor })).resolves.toEqual({ ok: false, error: 'We could not load more posts.' })
    await expect(loadMyCommentActivityPage({ cursor })).resolves.toEqual({ ok: false, error: 'We could not load more comments.' })
  })
})
