import { describe, expect, it, vi } from 'vitest'
import type { FeedRepository, HiddenPostRow } from './repository'

const viewerId = '11111111-1111-4111-8111-111111111111'
const authorId = '22222222-2222-4222-8222-222222222222'
const postId = '33333333-3333-4333-8333-333333333333'
const repostId = '44444444-4444-4444-8444-444444444444'
const companyId = '55555555-5555-4555-8555-555555555555'

type QueryCall = [text: string, values?: readonly unknown[]]

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

function hiddenRow(overrides: Partial<HiddenPostRow> = {}): HiddenPostRow {
  return {
    id: postId,
    body: 'Notes from our enclosed space entry drill.',
    post_type: 'standard',
    created_at: '2026-09-20T08:00:00.000Z',
    hidden_at: '2026-09-25T08:00:00.000Z',
    author_id: authorId,
    author_slug: 'rinki-mukharjee',
    author_name: 'Rinki Mukharjee',
    author_avatar_path: 'profiles/rinki/avatar.webp',
    company_id: null,
    company_slug: null,
    company_name: null,
    company_logo_path: null,
    source_body: null,
    media_path: null,
    media_mime_type: null,
    ...overrides,
  }
}

describe('feed repository: hidden posts', () => {
  it('lists the viewer’s hides newest first with author, organization, text and first media in one query', async () => {
    const query = vi.fn(async () => [hiddenRow()])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query: query as never })

    await expect(repository.listHiddenPosts(viewerId, 500)).resolves.toHaveLength(1)

    expect(query).toHaveBeenCalledTimes(1)
    const [sql, values] = callsOf(query)[0]
    expect(sql).toContain('from public.post_hides hidden')
    expect(sql).toContain('where hidden.user_id = $1')
    expect(sql).toContain('p.deleted_at is null')
    expect(sql).toContain('public.user_blocks')
    expect(sql).toContain('left join public.companies company')
    expect(sql).toContain('coalesce(p.repost_of_post_id, p.id)')
    expect(sql).toMatch(/order by hidden\.created_at desc, p\.id desc\s+limit \$2/)
    expect(values).toEqual([viewerId, 100])
  })

  it('deletes only the viewer’s own hide and reports whether one existed', async () => {
    const query = vi.fn(async () => [{ id: postId }])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query: query as never })

    await expect(repository.deleteHide(viewerId, postId)).resolves.toBe(true)
    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/delete from public\.post_hides where user_id = \$1 and post_id = \$2 returning/i)
    expect(values).toEqual([viewerId, postId])

    query.mockResolvedValueOnce([])
    await expect(repository.deleteHide(viewerId, postId)).resolves.toBe(false)
  })
})

describe('feed service: unhide', () => {
  async function serviceFor(repo: Partial<Record<keyof FeedRepository, unknown>>) {
    const { createFeedService } = await import('./service')
    return createFeedService({
      withTransaction: async <T>(fn: (repository: FeedRepository) => Promise<T>) => fn(repo as unknown as FeedRepository),
    })
  }

  it('removes the hide for a ready member', async () => {
    const repo = { isMemberReady: vi.fn(async () => true), deleteHide: vi.fn(async () => true) }
    await expect((await serviceFor(repo)).unhidePost(viewerId, postId)).resolves.toBe(true)
    expect(repo.deleteHide).toHaveBeenCalledWith(viewerId, postId)
  })

  it('refuses members who cannot use the feed', async () => {
    const repo = { isMemberReady: vi.fn(async () => false), deleteHide: vi.fn(async () => true) }
    await expect((await serviceFor(repo)).unhidePost(viewerId, postId)).rejects.toThrow()
    expect(repo.deleteHide).not.toHaveBeenCalled()
  })
})

describe('feed queries: my hidden posts', () => {
  it('maps previews, signs the author photo and photo/video thumbnails, and uses the original text for plain reposts', async () => {
    const rows = [
      hiddenRow({ media_path: `${authorId}/${postId}/one.jpg`, media_mime_type: 'image/jpeg' }),
      hiddenRow({
        id: repostId,
        post_type: 'repost',
        body: '',
        source_body: 'Original lesson text',
        author_avatar_path: null,
        company_id: companyId,
        company_slug: 'nordic-lng',
        company_name: 'Nordic LNG',
        company_logo_path: 'companies/logo.png',
        media_path: 'x/y/doc.pdf',
        media_mime_type: 'application/pdf',
      }),
      hiddenRow({ id: '66666666-6666-4666-8666-666666666666', author_slug: null }),
    ]
    const repository = { listHiddenPosts: vi.fn(async () => rows) }
    const resolveMediaUrls = vi.fn(async (paths: string[]) => new Map(paths.map((path) => [path, `signed:${path}`])))
    const { createFeedQueries } = await import('./queries')
    const queries = createFeedQueries({
      requireUser: vi.fn(async () => ({ id: viewerId })) as never,
      repository: repository as never,
      getPreferredAuthorIds: vi.fn(async () => []),
      resolveMediaUrls,
    })

    const posts = await queries.getMyHiddenPosts()

    expect(repository.listHiddenPosts).toHaveBeenCalledWith(viewerId, 50)
    expect(resolveMediaUrls).toHaveBeenCalledTimes(1)
    expect(resolveMediaUrls).toHaveBeenCalledWith(['profiles/rinki/avatar.webp', `${authorId}/${postId}/one.jpg`])
    expect(posts).toHaveLength(2)
    expect(posts[0]).toEqual({
      id: postId,
      body: 'Notes from our enclosed space entry drill.',
      isRepost: false,
      createdAt: '2026-09-20T08:00:00.000Z',
      hiddenAt: '2026-09-25T08:00:00.000Z',
      author: { id: authorId, slug: 'rinki-mukharjee', fullName: 'Rinki Mukharjee', avatarUrl: 'signed:profiles/rinki/avatar.webp' },
      organization: null,
      thumbnail: { url: `signed:${authorId}/${postId}/one.jpg`, mimeType: 'image/jpeg' },
    })
    expect(posts[1]).toMatchObject({
      id: repostId,
      body: 'Original lesson text',
      isRepost: true,
      organization: { id: companyId, slug: 'nordic-lng', name: 'Nordic LNG', logoUrl: `/api/company-logo/${companyId}` },
      thumbnail: null,
    })
  })

  it('returns an empty list without signing anything when nothing is hidden', async () => {
    const resolveMediaUrls = vi.fn(async () => new Map())
    const { createFeedQueries } = await import('./queries')
    const queries = createFeedQueries({
      requireUser: vi.fn(async () => ({ id: viewerId })) as never,
      repository: { listHiddenPosts: vi.fn(async () => []) } as never,
      getPreferredAuthorIds: vi.fn(async () => []),
      resolveMediaUrls,
    })
    await expect(queries.getMyHiddenPosts()).resolves.toEqual([])
    expect(resolveMediaUrls).not.toHaveBeenCalled()
  })
})
