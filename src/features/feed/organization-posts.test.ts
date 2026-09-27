import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AccessContext, OrganizationAccessRole } from '@/features/access/policy'
import type { FeedPostRow } from './mappers'
import type { FeedRepository } from './repository'

const authorId = '11111111-1111-4111-8111-111111111111'
const adminId = '22222222-2222-4222-8222-222222222222'
const strangerId = '33333333-3333-4333-8333-333333333333'
const companyId = '44444444-4444-4444-8444-444444444444'
const postId = '55555555-5555-4555-8555-555555555555'

type QueryCall = [text: string, values?: readonly unknown[]]

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

function access(role: OrganizationAccessRole | null, overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: role ? [{ companyId, plan: 'free', role, verified: true, entitlements: [] }] : [],
    accountActive: true,
    ...overrides,
  }
}

function feedRow(overrides: Partial<FeedPostRow> = {}): FeedPostRow {
  return {
    id: postId,
    category: 'maritime_news',
    body: 'We are hiring second officers for our LNG fleet.',
    post_type: 'standard',
    created_at: '2026-09-20T08:00:00.000Z',
    updated_at: '2026-09-20T08:00:00.000Z',
    profiles: {
      id: authorId,
      slug: 'priya-nair',
      full_name: 'Priya Nair',
      avatar_path: null,
      headline: 'HR Manager',
      maritime_profiles: null,
    },
    post_media: null,
    post_polls: null,
    post_reactions: { like: 0, support: 0, respect: 0, on_point: 0 },
    post_comment_count: { count: 0 },
    ...overrides,
  }
}

describe('migration 0044: posts as organization', () => {
  const sql = readFileSync(resolve(process.cwd(), 'infra/aws/database/migrations/0044_posts_as_organization.sql'), 'utf8')
  const normalized = sql.toLowerCase().replace(/\s+/g, ' ')

  it('adds a nullable company reference and its index, and is safe to run twice', () => {
    expect(sql).not.toMatch(/\btruncate\b|\bdelete\s+from\b|\bdrop\s+table\b|\bdrop\s+column\b|\bupdate\s+public\./i)
    expect(normalized).toContain('alter table public.posts add column if not exists company_id uuid references public.companies(id) on delete set null')
    expect(normalized).toContain('create index if not exists posts_company_created_idx on public.posts (company_id, created_at desc)')
    expect(normalized).not.toContain('not null references')
    const statements = sql.split('-- statement-breakpoint').map((part) => part.trim()).filter(Boolean)
    expect(statements).toHaveLength(2)
  })
})

describe('feed repository: organization posts', () => {
  it('selects the organization identity and whether the viewer follows it', async () => {
    const query = vi.fn(async () => [])
    const { createFeedRepository } = await import('./repository')
    await createFeedRepository({ query }).listFeedRows({ viewerProfileId: authorId, limit: 5 })
    const [sql] = callsOf(query)[0]
    expect(sql).toMatch(/left join public\.companies post_company on post_company\.id = p\.company_id/i)
    expect(sql).toMatch(/'logo_path', post_company\.logo_path/i)
    expect(sql).toMatch(/organization_follows viewer_org_follow[\s\S]*follower_id = \$1/i)
  })

  it('filters an organization page to its posts after the category filter', async () => {
    const query = vi.fn(async () => [])
    const { createFeedRepository } = await import('./repository')
    await createFeedRepository({ query }).listFeedRows({
      viewerProfileId: authorId,
      category: 'maritime_news',
      companyId,
      cursor: { createdAt: '2026-09-20T08:00:00.000Z', id: postId },
      limit: 11,
    })
    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/p\.company_id = \$3/i)
    expect(sql).toMatch(/\(p\.created_at < \$4 or \(p\.created_at = \$4 and p\.id < \$5\)\)/i)
    // Same audience rules as the main feed: blocks and hidden posts still apply.
    expect(sql).toMatch(/user_blocks/i)
    expect(sql).toMatch(/post_hides/i)
    expect(values).toEqual([authorId, 'maritime_news', companyId, '2026-09-20T08:00:00.000Z', postId, 11])
  })

  it('keeps organization posts off personal profile lists when asked', async () => {
    const query = vi.fn(async () => [])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })
    await repository.listAuthorRows({ viewerProfileId: authorId, authorProfileId: authorId, limit: 30, personalOnly: true })
    await repository.listAuthorRows({ viewerProfileId: authorId, authorProfileId: authorId })
    expect(callsOf(query)[0][0]).toMatch(/p\.deleted_at is null\s+and p\.company_id is null/i)
    expect(callsOf(query)[1][0]).not.toMatch(/p\.company_id is null/i)
  })

  it('stores the organization on new standard and poll posts only when one is chosen', async () => {
    const query = vi.fn(async () => [])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })
    await repository.insertStandardPost({ id: postId, authorId, category: 'maritime_news', body: 'Hello', companyId })
    await repository.insertStandardPost({ id: postId, authorId, category: 'maritime_news', body: 'Hello' })
    await repository.insertPollPost({ id: postId, authorId, category: 'maritime_news', body: 'Vote', companyId })
    const calls = callsOf(query)
    expect(calls[0][0]).toMatch(/insert into public\.posts \(id, author_id, category, body, post_type, company_id\)/i)
    expect(calls[0][1]).toEqual([postId, authorId, 'maritime_news', 'Hello', companyId])
    expect(calls[1][0]).not.toMatch(/company_id/i)
    expect(calls[2][0]).toMatch(/'poll', \$5/i)
    expect(calls[3][0]).toMatch(/insert into public\.post_polls/i)
  })

  it('lets organization admins delete only posts published as their organization, with an audit record', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ id: postId }])
      .mockResolvedValueOnce([])
    const { createFeedRepository } = await import('./repository')
    await expect(createFeedRepository({ query }).deleteOrganizationPost(adminId, postId, companyId)).resolves.toBe(true)
    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/where id = \$2\s+and company_id = \$3\s+and deleted_at is null/i)
    expect(values).toEqual([adminId, postId, companyId])
    expect(callsOf(query)[1][0]).toMatch(/content\.post_deleted_by_organization_admin/)
  })

  it('updates post text and replaces its mentions, reporting only new ones', async () => {
    const mentionedId = '66666666-6666-4666-8666-666666666666'
    const keptId = '77777777-7777-4777-8777-777777777777'
    const query = vi.fn(async (text: string, values?: readonly unknown[]): Promise<Array<Record<string, unknown>>> => {
      void values
      return /update public\.posts/i.test(text) ? [{ id: postId }] : []
    })
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })
    await expect(repository.updatePostBody(postId, 'Edited text')).resolves.toBe(true)
    expect(callsOf(query)[0][0]).toMatch(/set body = \$2,\s+updated_at = now\(\)\s+where id = \$1 and deleted_at is null/i)

    query.mockImplementation(async (text: string, values?: readonly unknown[]) => {
      if (/select mentioned_profile_id as id from public\.content_mentions where post_id/i.test(text)) return [{ id: keptId }]
      if (/select exists/i.test(text)) return [{ allowed: true }]
      if (/insert into public\.content_mentions/i.test(text)) return [{ id: values?.[2] }]
      return []
    })
    await expect(repository.replacePostMentions(authorId, postId, [keptId, mentionedId])).resolves.toEqual({
      mentionProfileIds: [keptId, mentionedId],
      newlyIntroducedProfileIds: [mentionedId],
    })
    expect(callsOf(query).some(([text]) => /delete from public\.content_mentions where post_id = \$1/i.test(text))).toBe(true)
  })
})

function serviceRepository(overrides: Partial<Record<keyof FeedRepository, unknown>> = {}) {
  return {
    isMemberReady: vi.fn(async () => true),
    insertStandardPost: vi.fn(async () => undefined),
    insertPollPost: vi.fn(async () => undefined),
    insertPollOption: vi.fn(async () => undefined),
    deleteOwnPost: vi.fn(async () => false),
    deleteOrganizationPost: vi.fn(async () => true),
    getPostForManagement: vi.fn(async () => ({ id: postId, authorId, companyId, postType: 'standard', body: 'Before' })),
    updatePostBody: vi.fn(async () => true),
    replacePostMentions: vi.fn(async () => ({ mentionProfileIds: [], newlyIntroducedProfileIds: [] })),
    getRestorablePostCompanyId: vi.fn(async () => companyId),
    restoreOwnDeletedPost: vi.fn(async () => true),
    ...overrides,
  } as unknown as FeedRepository
}

async function serviceFor(repository: FeedRepository, contexts: Record<string, AccessContext>) {
  const { createFeedService } = await import('./service')
  const loadAccessContext = vi.fn(async (profileId: string) => contexts[profileId] ?? access(null))
  return {
    loadAccessContext,
    service: createFeedService({
      createId: () => postId,
      withTransaction: async <T>(fn: (repository: FeedRepository) => Promise<T>) => fn(repository),
      loadAccessContext,
    }),
  }
}

describe('feed service: posting as an organization', () => {
  it('publishes as the organization only for members with a posting role', async () => {
    const repository = serviceRepository()
    const { service } = await serviceFor(repository, { [authorId]: access('content_manager'), [strangerId]: access('recruiter') })

    await expect(service.createStandardPost(authorId, { category: 'maritime_news', body: ' Hiring ', companyId })).resolves.toBe(postId)
    expect(repository.insertStandardPost).toHaveBeenCalledWith({ id: postId, authorId, category: 'maritime_news', body: 'Hiring', companyId })

    await expect(service.createStandardPost(strangerId, { category: 'maritime_news', body: 'Hiring', companyId })).rejects.toThrow('feed_organization_post_forbidden')
    await expect(service.createPollPost(strangerId, { category: 'maritime_news', body: 'Vote', pollOptions: ['A', 'B'], companyId })).rejects.toThrow('feed_organization_post_forbidden')
    expect(repository.insertStandardPost).toHaveBeenCalledTimes(1)
    expect(repository.insertPollPost).not.toHaveBeenCalled()
  })

  it('never loads roles for personal posts', async () => {
    const repository = serviceRepository()
    const { service, loadAccessContext } = await serviceFor(repository, {})
    await service.createStandardPost(authorId, { category: 'maritime_news', body: 'Personal update' })
    expect(loadAccessContext).not.toHaveBeenCalled()
    expect(repository.insertStandardPost).toHaveBeenCalledWith({ id: postId, authorId, category: 'maritime_news', body: 'Personal update' })
  })

  it('lets the author (while still posting for the organization) and organization admins edit', async () => {
    const repository = serviceRepository()
    const { service } = await serviceFor(repository, {
      [authorId]: access('content_manager'),
      [adminId]: access('administrator'),
      [strangerId]: access('member'),
    })
    await expect(service.updatePost(authorId, postId, { body: ' New text ' })).resolves.toEqual({ id: postId, postType: 'standard' })
    expect(repository.updatePostBody).toHaveBeenCalledWith(postId, 'New text')
    await expect(service.updatePost(adminId, postId, { body: 'Admin fix' })).resolves.toEqual({ id: postId, postType: 'standard' })
    await expect(service.updatePost(strangerId, postId, { body: 'Nope' })).rejects.toThrow('feed_post_edit_forbidden')
  })

  it('stops an author who lost their organization role from editing, but not from deleting', async () => {
    const repository = serviceRepository({ deleteOwnPost: vi.fn(async () => true) })
    const { service } = await serviceFor(repository, { [authorId]: access('member') })
    await expect(service.updatePost(authorId, postId, { body: 'Edit' })).rejects.toThrow('feed_post_edit_forbidden')
    await expect(service.deletePost(authorId, postId)).resolves.toBe(true)
  })

  it('keeps personal posts editable only by their author, and requires text except on reposts', async () => {
    const repository = serviceRepository({
      getPostForManagement: vi.fn(async () => ({ id: postId, authorId, companyId: null, postType: 'standard', body: 'Before' })),
    })
    const { service, loadAccessContext } = await serviceFor(repository, {})
    await expect(service.updatePost(adminId, postId, { body: 'Edit' })).rejects.toThrow('feed_post_edit_forbidden')
    await expect(service.updatePost(authorId, postId, { body: '   ' })).rejects.toThrow('feed_post_body_required')
    expect(loadAccessContext).not.toHaveBeenCalled()

    const repostRepository = serviceRepository({
      getPostForManagement: vi.fn(async () => ({ id: postId, authorId, companyId: null, postType: 'repost', body: 'Thoughts' })),
    })
    const repost = await serviceFor(repostRepository, {})
    await expect(repost.service.updatePost(authorId, postId, { body: '' })).resolves.toEqual({ id: postId, postType: 'repost' })
    await expect(repost.service.updatePost(authorId, postId, { body: 'x'.repeat(3001) })).rejects.toThrow('feed_post_body_too_long')
  })

  it('lets organization admins delete organization posts they did not write', async () => {
    const repository = serviceRepository()
    const { service } = await serviceFor(repository, { [adminId]: access('owner'), [strangerId]: access('content_manager') })
    await expect(service.deletePost(adminId, postId)).resolves.toBe(true)
    expect(repository.deleteOrganizationPost).toHaveBeenCalledWith(adminId, postId, companyId)
    await expect(service.deletePost(strangerId, postId)).rejects.toThrow('feed_post_delete_forbidden')
  })

  it('refuses to restore an organization post once the author no longer posts for it', async () => {
    const repository = serviceRepository()
    const { service } = await serviceFor(repository, { [authorId]: access(null) })
    await expect(service.restoreDeletedPost(authorId, postId)).rejects.toThrow('feed_post_restore_organization_forbidden')
    expect(repository.restoreOwnDeletedPost).not.toHaveBeenCalled()

    const allowed = await serviceFor(serviceRepository(), { [authorId]: access('owner') })
    await expect(allowed.service.restoreDeletedPost(authorId, postId)).resolves.toBe(true)
  })
})

describe('feed queries: organization posts', () => {
  async function queriesFor(rows: FeedPostRow[], viewerAccess: AccessContext, preferred: string[] = []) {
    const repository = {
      listFeedRows: vi.fn(async () => rows),
      getViewerState: vi.fn(async () => ({ postReactions: new Map(), likedPostIds: new Set<string>(), savedPostIds: new Set<string>(), pollVotes: new Map<string, string>() })),
      getComments: vi.fn(async () => []),
      listCompanyIdentities: vi.fn(async () => [
        { id: companyId, slug: 'nordic-lng', name: 'Nordic LNG Carriers', logoPath: 'companies/nordic/logo.png' },
      ]),
    } as unknown as FeedRepository
    const loadAccessContext = vi.fn(async () => viewerAccess)
    const { createFeedQueries } = await import('./queries')
    const queries = createFeedQueries({
      requireUser: async () => ({ id: adminId, cognitoSub: 'sub', email: null }),
      repository,
      getPreferredAuthorIds: vi.fn(async () => preferred),
      resolveMediaUrls: vi.fn(async () => new Map()),
      loadAccessContext,
    })
    return { queries, repository, loadAccessContext }
  }

  it('shows the organization identity and gives its admins edit and delete', async () => {
    const organizationRow = feedRow({
      company_id: companyId,
      organization: { id: companyId, slug: 'nordic-lng', name: 'Nordic LNG Carriers', logo_path: 'companies/nordic/logo.png' },
    })
    const { queries } = await queriesFor([organizationRow], access('administrator'))
    const page = await queries.getFeedPage({ limit: 5 })
    expect(page.posts[0]).toMatchObject({
      organization: { id: companyId, slug: 'nordic-lng', name: 'Nordic LNG Carriers', logoUrl: `/api/company-logo/${companyId}` },
      viewerOwns: false,
      viewerCanEdit: true,
      viewerCanDelete: true,
    })
  })

  it('does not load roles when a page has no organization posts', async () => {
    const { queries, loadAccessContext } = await queriesFor([feedRow()], access('administrator'))
    const page = await queries.getFeedPage({ limit: 5 })
    expect(loadAccessContext).not.toHaveBeenCalled()
    expect(page.posts[0]).toMatchObject({ organization: null, viewerCanEdit: false, viewerCanDelete: false })
  })

  it('lifts posts from organizations the viewer follows, like posts from people they follow', async () => {
    const newer = feedRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', created_at: '2026-09-20T09:00:00.000Z' })
    const followedOrganization = feedRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      created_at: '2026-09-20T08:00:00.000Z',
      company_id: companyId,
      organization: { id: companyId, slug: 'nordic-lng', name: 'Nordic LNG Carriers', logo_path: null },
      viewer_follows_organization: true,
    })
    const { queries } = await queriesFor([newer, followedOrganization], access(null))
    const page = await queries.getFeedPage({ limit: 5 })
    expect(page.posts.map((post) => post.id)).toEqual([followedOrganization.id, newer.id])
  })

  it('keeps an organization page newest first and passes the organization filter', async () => {
    const older = feedRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', company_id: companyId, viewer_follows_organization: true })
    const newer = feedRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', company_id: companyId })
    const { queries, repository } = await queriesFor([newer, older], access(null), [authorId])
    const page = await queries.getFeedPage({ companyId, limit: 5 })
    expect(repository.listFeedRows).toHaveBeenCalledWith({ viewerProfileId: adminId, companyId, limit: 6 })
    expect(page.posts.map((post) => post.id)).toEqual([newer.id, older.id])
  })

  it('lists the organizations the member can post for with their logos', async () => {
    const { queries, repository } = await queriesFor([], access('content_manager'))
    await expect(queries.getPostingOrganizations()).resolves.toEqual([
      { id: companyId, slug: 'nordic-lng', name: 'Nordic LNG Carriers', logoUrl: `/api/company-logo/${companyId}` },
    ])
    expect(repository.listCompanyIdentities).toHaveBeenCalledWith([companyId])

    const none = await queriesFor([], access('recruiter'))
    await expect(none.queries.getPostingOrganizations()).resolves.toEqual([])
    expect(none.repository.listCompanyIdentities).not.toHaveBeenCalled()
  })
})
