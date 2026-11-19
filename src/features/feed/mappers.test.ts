import { describe, expect, it } from 'vitest'
import { mapFeedPost, mapHiddenPost, mapOrganization, mapOrganizationMentions, organizationLogoUrl, type FeedPostRow } from './mappers'

const viewer = {
  likedPostIds: new Set(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),
  savedPostIds: new Set(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),
  pollVotes: new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'option-b']]),
}

function row(overrides: Partial<FeedPostRow> = {}): FeedPostRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    category: 'technical_discussion',
    body: 'Technical lesson',
    post_type: 'poll',
    created_at: '2026-09-02T10:00:00.000Z',
    updated_at: '2026-09-02T10:00:00.000Z',
    profiles: {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'member-a',
      full_name: 'Member A',
      avatar_path: null,
      headline: 'Chief Officer | Tankers',
      maritime_profiles: null,
    },
    post_media: {
      storage_path: '111/post/image.jpg',
      mime_type: 'image/jpeg',
      alt_text: 'Engine room diagram',
    },
    post_polls: {
      post_poll_options: [
        { id: 'option-b', label: 'B', position: 1, post_poll_votes: [{ count: 2 }] },
        { id: 'option-a', label: 'A', position: 0, post_poll_votes: [{ count: 3 }] },
      ],
    },
    post_reactions: [{ count: 7 }],
    post_comments: [],
    ...overrides,
  }
}

describe('mapFeedPost', () => {
  it('maps missing maritime summary values to null', () => {
    const mapped = mapFeedPost(row(), viewer)
    expect(mapped.author.rank).toBeNull()
    expect(mapped.author.currentCompany).toBeNull()
  })

  it('maps the community group with its photo URL from icon_path (round 9C)', () => {
    const groupId = '22222222-2222-4222-8222-222222222222'
    const withPhoto = mapFeedPost(row({ group_id: groupId, post_group: { id: groupId, slug: 'marine-engineers', name: 'Marine Engineers', visibility: 'private', icon_path: `communities/${groupId}/icon-abc.webp` } }), viewer)
    expect(withPhoto.group).toEqual({ id: groupId, slug: 'marine-engineers', name: 'Marine Engineers', visibility: 'private', iconUrl: `/api/community-media/${groupId}/icon?v=icon-abc.webp` })

    const withoutPhoto = mapFeedPost(row({ group_id: groupId, post_group: { id: groupId, slug: 'marine-engineers', name: 'Marine Engineers', visibility: 'public' } }), viewer)
    expect(withoutPhoto.group).toEqual({ id: groupId, slug: 'marine-engineers', name: 'Marine Engineers', visibility: 'public', iconUrl: null })
    expect(mapFeedPost(row({ post_group: null }), viewer).group).toBeNull()
  })

  it('maps viewer state, counts, signed media and ordered poll options', () => {
    const signed = new Map([['111/post/image.jpg', 'https://example.test/signed-image']])
    const mapped = mapFeedPost(row(), viewer, signed)
    expect(mapped.likeCount).toBe(7)
    expect(mapped.viewerLiked).toBe(true)
    expect(mapped.viewerSaved).toBe(true)
    expect(mapped.media?.signedUrl).toBe('https://example.test/signed-image')
    expect(mapped.poll?.viewerOptionId).toBe('option-b')
    expect(mapped.poll?.totalVotes).toBe(5)
    expect(mapped.poll?.options.map((option) => option.id)).toEqual(['option-a', 'option-b'])
  })

  it('maps ordered rich-media collections and preserves document metadata', () => {
    const mapped = mapFeedPost(row({
      post_type: 'standard',
      post_polls: null,
      post_media: [
        {
          storage_path: '111/post/second.jpg',
          mime_type: 'image/jpeg',
          alt_text: 'Second',
          position: 1,
          file_name: 'second.jpg',
          page_count: null,
        },
        {
          storage_path: '111/post/first.jpg',
          mime_type: 'image/jpeg',
          alt_text: 'First',
          position: 0,
          file_name: 'first.jpg',
          page_count: null,
        },
      ],
    }), viewer, new Map([
      ['111/post/first.jpg', 'https://example.test/first'],
      ['111/post/second.jpg', 'https://example.test/second'],
    ]))

    expect(mapped.mediaItems).toEqual([
      expect.objectContaining({ storagePath: '111/post/first.jpg', position: 0, fileName: 'first.jpg', signedUrl: 'https://example.test/first' }),
      expect.objectContaining({ storagePath: '111/post/second.jpg', position: 1, fileName: 'second.jpg', signedUrl: 'https://example.test/second' }),
    ])
    expect(mapped.media).toEqual(mapped.mediaItems?.[0])
  })

  it('maps comments with real authors', () => {
    const mapped = mapFeedPost(row({
      post_type: 'standard',
      post_polls: null,
      post_comments: [{
        id: 'comment-1',
        body: 'Useful lesson',
        created_at: '2026-09-02T10:05:00.000Z',
        profiles: {
          id: '22222222-2222-4222-8222-222222222222',
          slug: 'member-b',
          full_name: 'Member B',
          avatar_path: null,
          headline: null,
          maritime_profiles: { rank: 'Second Engineer', current_company: 'Example Shipping' },
        },
      }],
    }), viewer)
    expect(mapped.comments[0]?.author.rank).toBe('Second Engineer')
    expect(mapped.commentCount).toBe(1)
  })

  it('maps server-authoritative comment ownership, edit eligibility and deletion metadata', () => {
    const comment = {
      id: 'comment-1',
      body: 'Useful lesson',
      created_at: '2026-09-10T09:00:00.000Z',
      updated_at: '2026-09-10T09:10:00.000Z',
      deleted_at: null,
      viewer_owns: true,
      can_edit: true,
      profiles: {
        id: '22222222-2222-4222-8222-222222222222',
        slug: 'member-b',
        full_name: 'Member B',
        avatar_path: null,
        headline: null,
        maritime_profiles: null,
      },
    } as unknown as NonNullable<FeedPostRow['post_comments']>[number]

    const mapped = mapFeedPost(row({
      post_type: 'standard',
      post_polls: null,
      post_comments: [comment],
    }), viewer)

    expect(mapped.comments[0]).toMatchObject({
      updatedAt: '2026-09-10T09:10:00.000Z',
      viewerOwns: true,
      canEdit: true,
      deleted: false,
    })
  })
})

describe('organization logo routes (request cuts)', () => {
  const companyId = '44444444-4444-4444-8444-444444444444'

  it('uses the cacheable public route only for a verified organization with a logo', () => {
    expect(organizationLogoUrl(companyId, 'companies/logo.png', true)).toBe(`/api/public/company-logo/${companyId}`)
    expect(organizationLogoUrl(companyId, 'companies/logo.png', false)).toBe(`/api/company-logo/${companyId}`)
    expect(organizationLogoUrl(companyId, 'companies/logo.png', null)).toBe(`/api/company-logo/${companyId}`)
    expect(organizationLogoUrl(companyId, 'companies/logo.png')).toBe(`/api/company-logo/${companyId}`)
    expect(organizationLogoUrl(companyId, '  ', true)).toBeNull()
    expect(organizationLogoUrl(companyId, null, true)).toBeNull()
  })

  it('carries the verified flag through post organizations, organization mentions and hidden posts', () => {
    const identity = { id: companyId, slug: 'nordic-lng', name: 'Nordic LNG', logo_path: 'companies/logo.png' }
    expect(mapOrganization({ ...identity, is_verified: true })?.logoUrl).toBe(`/api/public/company-logo/${companyId}`)
    expect(mapOrganization({ ...identity, is_verified: false })?.logoUrl).toBe(`/api/company-logo/${companyId}`)
    expect(mapOrganization(identity)?.logoUrl).toBe(`/api/company-logo/${companyId}`)

    const mention = { company_id: companyId, slug: 'nordic-lng', name: 'Nordic LNG', logo_path: 'companies/logo.png' }
    expect(mapOrganizationMentions([
      { ...mention, is_verified: true },
      { ...mention, is_verified: false },
      mention,
    ]).map((item) => item.logoUrl)).toEqual([
      `/api/public/company-logo/${companyId}`,
      `/api/company-logo/${companyId}`,
      `/api/company-logo/${companyId}`,
    ])

    const hidden = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      body: 'Body',
      post_type: 'standard' as const,
      created_at: '2026-09-20T08:00:00.000Z',
      hidden_at: '2026-09-25T08:00:00.000Z',
      author_id: '11111111-1111-4111-8111-111111111111',
      author_slug: 'member-a',
      author_name: 'Member A',
      author_avatar_path: null,
      company_id: companyId,
      company_slug: 'nordic-lng',
      company_name: 'Nordic LNG',
      company_logo_path: 'companies/logo.png',
      source_body: null,
      media_path: null,
      media_mime_type: null,
    }
    expect(mapHiddenPost({ ...hidden, company_is_verified: true }, new Map())?.organization?.logoUrl).toBe(`/api/public/company-logo/${companyId}`)
    expect(mapHiddenPost({ ...hidden, company_is_verified: false }, new Map())?.organization?.logoUrl).toBe(`/api/company-logo/${companyId}`)
  })
})
