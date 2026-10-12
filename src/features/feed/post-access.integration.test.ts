import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * Round F against the real schema (PGlite, every migration): who may open a post (members, tagged
 * members, signed-out visitors), what a signed-out visitor may read, and how tag notifications
 * behave when a post is deleted or a tag removed. Placeholder data only.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { createFeedRepository } = await import('./repository')
const { createFeedQueries } = await import('./queries')
const { createNotificationRepository } = await import('@/features/notifications/repository')
const { createNotificationQueries } = await import('@/features/notifications/queries')

beforeAll(async () => {
  db = await createTestDatabase()
  // Fixture members only need to count as onboarded; the full identity fields are not what these tests are about.
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

let sequence = 0
const ids = { author: '', tagged: '', outsider: '', groupMember: '' }

async function member(name: string) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at)
     values (gen_random_uuid(), $1, $2, now()) returning id`,
    [name, `fixture-member-${sequence}`],
  )
  return rows[0]!.id as string
}

async function post(options: { audience?: 'anyone' | 'members'; groupId?: string; body?: string; deleted?: boolean } = {}) {
  const rows = await db.query(
    `insert into public.posts (id, author_id, category, body, post_type, group_id, audience, deleted_at, deleted_by, deletion_reason, purge_after)
     values (gen_random_uuid(), $1, 'technical_discussion', $2, 'standard', $3, $4,
             case when $5 then now() end, case when $5 then $1::uuid end, case when $5 then 'author' end, case when $5 then now() + interval '30 days' end)
     returning id`,
    [ids.author, options.body ?? 'Fixture post text', options.groupId ?? null, options.audience ?? 'members', Boolean(options.deleted)],
  )
  return rows[0]!.id as string
}

async function photo(postId: string, taggedProfileId?: string) {
  sequence += 1
  const media = await db.query(
    `insert into public.post_media (post_id, storage_path, mime_type, position)
     values ($1, $2, 'image/jpeg', 0) returning id`,
    [postId, `posts/fixture/${sequence}.jpg`],
  )
  const mediaId = media[0]!.id as string
  if (taggedProfileId) {
    await db.query(`insert into public.post_photo_tags (post_id, media_id, tagged_profile_id, tagged_by) values ($1, $2, $3, $4)`, [postId, mediaId, taggedProfileId, ids.author])
    await db.query(
      `insert into public.notifications (recipient_id, actor_id, notification_type, post_id, dedupe_key)
       values ($1, $2, 'photo_tag', $3, $4)`,
      [taggedProfileId, ids.author, postId, `photo-tag:${postId}:${taggedProfileId}`],
    )
  }
  return mediaId
}

async function privateGroup() {
  sequence += 1
  const rows = await db.query(
    `insert into public.community_groups (name, slug, visibility, created_by) values ($1, $2, 'private', $3) returning id`,
    [`Fixture Group ${sequence}`, `fixture-group-${sequence}`, ids.author],
  )
  const groupId = rows[0]!.id as string
  for (const profileId of [ids.author, ids.groupMember]) {
    await db.query(`insert into public.community_group_memberships (group_id, profile_id, role, status, joined_at) values ($1, $2, 'member', 'active', now())`, [groupId, profileId])
  }
  return groupId
}

const repository = () => createFeedRepository({ query: (text, values) => db.query(text, values) })

function feedQueries(viewerId?: string) {
  return createFeedQueries({
    requireUser: async () => ({ id: viewerId ?? ids.author }) as never,
    repository: repository(),
    getPreferredAuthorIds: async () => [],
    resolveMediaUrls: async (paths) => new Map(paths.map((path) => [path, `https://media.example.test/${path}`])),
    loadAccessContext: async () => ({ organizationMemberships: [] }) as never,
    listAdministeredGroupIds: async () => [],
  })
}

function notificationQueries(recipientId: string) {
  return createNotificationQueries({
    requireUser: async () => ({ id: recipientId }),
    repository: createNotificationRepository({ query: (text, values) => db.query(text, values) }),
    getProfiles: async () => [],
    resolveMediaUrls: async (paths) => new Map(paths.map((path) => [path, `https://media.example.test/${path}`])),
  })
}

beforeEach(async () => {
  await db.query(`delete from public.notifications`)
  await db.query(`delete from public.posts`)
  await db.query(`delete from public.community_groups`)
  await db.query(`delete from public.profiles`)
  ids.author = await member('Fixture Author')
  ids.tagged = await member('Fixture Tagged')
  ids.outsider = await member('Fixture Outsider')
  ids.groupMember = await member('Fixture Group Member')
})

describe('post access (round F)', () => {
  it('lets a tagged member open a private-community post, but no other non-member', async () => {
    const groupId = await privateGroup()
    const postId = await post({ groupId })
    await photo(postId, ids.tagged)

    expect(await repository().getPostRow(ids.tagged, postId)).not.toBeNull()
    expect(await repository().getPostRow(ids.groupMember, postId)).not.toBeNull()
    expect(await repository().getPostRow(ids.outsider, postId)).toBeNull()
    // The exception is for the post page only: the community feed stays closed to them.
    expect(await repository().listFeedRows({ viewerProfileId: ids.tagged, groupId, limit: 10 })).toEqual([])
  })

  it('lets an @mentioned member open a private-community post too', async () => {
    const groupId = await privateGroup()
    const postId = await post({ groupId })
    await db.query(`insert into public.content_mentions (id, post_id, actor_id, mentioned_profile_id) values (gen_random_uuid(), $1, $2, $3)`, [postId, ids.author, ids.tagged])
    expect(await repository().getPostRow(ids.tagged, postId)).not.toBeNull()
  })

  it('shows a signed-out visitor only an "Anyone" post outside any community', async () => {
    const anyone = await post({ audience: 'anyone', body: 'A public fixture update' })
    const members = await post({ audience: 'members', body: 'A members-only fixture update' })
    const groupId = await privateGroup()
    const inGroup = await post({ audience: 'anyone', groupId })
    const deleted = await post({ audience: 'anyone', deleted: true })

    const queries = feedQueries()
    const shown = await queries.getPostPage(anyone, null)
    expect(shown.kind).toBe('public')
    if (shown.kind === 'public') {
      expect(shown.post.body).toBe('A public fixture update')
      expect(shown.post.comments).toEqual([])
    }
    expect(await queries.getPostPage(members, null)).toEqual({ kind: 'members_only' })
    expect(await queries.getPostPage(inGroup, null)).toEqual({ kind: 'members_only' })
    expect(await queries.getPostPage(deleted, null)).toEqual({ kind: 'missing' })
    expect(await queries.getPostPage('not-a-uuid', null)).toEqual({ kind: 'missing' })
    expect(await queries.getPostPage('00000000-0000-4000-8000-000000000000', null)).toEqual({ kind: 'missing' })
  })

  it('never shows a signed-out visitor an "Anyone" post by a suspended author', async () => {
    const postId = await post({ audience: 'anyone' })
    await db.query(`update public.profiles set account_status = 'suspended' where id = $1`, [ids.author])
    expect(await feedQueries().getPostPage(postId, null)).toEqual({ kind: 'members_only' })
  })

  it('lists only "Anyone" posts on a profile seen signed out (no private-community posts)', async () => {
    await post({ audience: 'anyone', body: 'Shown to anyone' })
    await post({ audience: 'members', body: 'Members only' })
    const groupId = await privateGroup()
    await post({ audience: 'anyone', groupId, body: 'Inside a private group' })

    const posts = await feedQueries().getPublicPostsByAuthor(ids.author)
    expect(posts.map((item) => item.body)).toEqual(['Shown to anyone'])
  })

  it('lets a tagged member, and for an "Anyone" post a signed-out visitor, load the post\'s photos', async () => {
    const groupId = await privateGroup()
    const inGroup = await post({ groupId })
    await photo(inGroup, ids.tagged)
    const anyone = await post({ audience: 'anyone' })
    const members = await post({ audience: 'members' })

    expect(await repository().isPostVisibleTo(ids.tagged, inGroup, ids.author)).toBe(true)
    expect(await repository().isPostVisibleTo(ids.outsider, inGroup, ids.author)).toBe(false)
    expect(await repository().isPostPublic(anyone, ids.author)).toBe(true)
    expect(await repository().isPostPublic(members, ids.author)).toBe(false)
    expect(await repository().isPostPublic(inGroup, ids.author)).toBe(false)
  })

  it('serves a share image only for an "Anyone" post with a photo', async () => {
    const anyone = await post({ audience: 'anyone' })
    await photo(anyone)
    const members = await post({ audience: 'members' })
    await photo(members)
    expect(await repository().getPublicPostImagePath(anyone)).toMatch(/^posts\/fixture\//)
    expect(await repository().getPublicPostImagePath(members)).toBeNull()
  })

  it('keeps a new post members-only unless its author picks Anyone, and community posts always', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    await repository().insertStandardPost({ id, authorId: ids.author, category: 'technical_discussion', body: 'x', audience: 'anyone' })
    expect((await db.query(`select audience from public.posts where id = $1`, [id]))[0]!.audience).toBe('anyone')
    expect(await repository().updatePostAudience(id, 'members')).toBe(true)
    expect((await db.query(`select audience from public.posts where id = $1`, [id]))[0]!.audience).toBe('members')
    await expect(db.query(`insert into public.posts (author_id, category, body, post_type, audience) values ($1, 'technical_discussion', 'x', 'standard', 'everyone')`, [ids.author])).rejects.toThrow()
  })
})

describe('tag notifications (round F)', () => {
  it('opens the post at the tagged photo, and lists it under Mentions', async () => {
    const groupId = await privateGroup()
    const postId = await post({ groupId })
    const mediaId = await photo(postId, ids.tagged)

    const [row] = await notificationQueries(ids.tagged).getNotifications()
    expect(row?.type).toBe('photo_tag')
    expect(row?.postUnavailable).toBe(false)
    expect(row?.destination).toBe(`/posts/${postId}?photo=${mediaId}`)
    expect(row?.postPreview?.mediaType).toBe('image')
    const { notificationMatchesFilter } = await import('@/features/notifications/filters')
    expect(notificationMatchesFilter(row!, 'mentions')).toBe(true)
  })

  it('says "no longer available" once the post is deleted', async () => {
    const postId = await post()
    await photo(postId, ids.tagged)
    await db.query(`update public.posts set deleted_at = now(), deleted_by = author_id, deletion_reason = 'author', purge_after = now() + interval '30 days' where id = $1`, [postId])

    const [row] = await notificationQueries(ids.tagged).getNotifications()
    expect(row?.postUnavailable).toBe(true)
    expect(row?.postPreview).toBeNull()
  })

  it('removes the notification when the member\'s last tag in the post is removed', async () => {
    const postId = await post()
    const first = await photo(postId, ids.tagged)
    await db.query(`delete from public.post_media where post_id = $1 and id <> $2`, [postId, first])

    expect(await repository().deletePhotoTag(ids.author, postId, first, ids.tagged)).toBe(true)
    expect(await db.query(`select id from public.notifications where recipient_id = $1`, [ids.tagged])).toEqual([])
  })

  it('removes a mention notification when an edit drops the mention', async () => {
    const postId = await post()
    await repository().replacePostMentions(ids.author, postId, [ids.tagged])
    await db.query(
      `insert into public.notifications (recipient_id, actor_id, notification_type, post_id, dedupe_key) values ($1, $2, 'post_mention', $3, $4)`,
      [ids.tagged, ids.author, postId, `post-mention:${postId}:${ids.tagged}`],
    )
    await repository().replacePostMentions(ids.author, postId, [])
    expect(await db.query(`select id from public.notifications where recipient_id = $1`, [ids.tagged])).toEqual([])
  })
})
