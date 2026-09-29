import { describe, expect, it, vi } from 'vitest'

const actorId = '11111111-1111-4111-8111-111111111111'
const friendId = '22222222-2222-4222-8222-222222222222'
const blockedId = '33333333-3333-4333-8333-333333333333'
const postId = '55555555-5555-4555-8555-555555555555'
const mediaId = '66666666-6666-4666-8666-666666666666'
const photoPath = `${actorId}/${postId}/photo.jpg`
const documentPath = `${actorId}/${postId}/deck.pdf`

type QueryCall = [text: string, values?: readonly unknown[]]

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

/**
 * A fake database: only the photo storage path resolves to an image media row, the
 * blocked member fails the block/readiness check, and every insert returns its profile id.
 */
function fakeQuery() {
  return vi.fn(async (text: string, values?: readonly unknown[]) => {
    if (/from public\.post_media/i.test(text)) {
      return values?.[1] === photoPath ? [{ id: mediaId }] : []
    }
    if (/as allowed/i.test(text)) {
      return [{ allowed: values?.[1] !== blockedId }]
    }
    if (/insert into public\.post_photo_tags/i.test(text)) {
      return [{ id: values?.[2] }]
    }
    return []
  })
}

describe('feed repository: photo tags (round 9B)', () => {
  it('tags allowed members in an image and skips a blocked pair', async () => {
    const query = fakeQuery()
    const { createFeedRepository } = await import('./repository')
    const inserted = await createFeedRepository({ query }).insertPhotoTags(actorId, postId, [
      { storagePath: photoPath, profileIds: [friendId, blockedId, friendId] },
    ])

    expect(inserted).toEqual([{ mediaId, profileId: friendId }])
    const calls = callsOf(query)
    const inserts = calls.filter(([sql]) => /insert into public\.post_photo_tags/i.test(sql))
    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.[1]).toEqual([postId, mediaId, friendId, actorId])
    expect(inserts[0]?.[0]).toMatch(/on conflict \(media_id, tagged_profile_id\) do nothing/i)
    // The block check runs both directions before a member is tagged.
    const checks = calls.filter(([sql]) => /as allowed/i.test(sql))
    expect(checks.map(([, values]) => values?.[1])).toEqual([friendId, blockedId])
    expect(checks[0]?.[0]).toMatch(/b\.blocker_id = \$1 and b\.blocked_id = \$2\) or \(b\.blocker_id = \$2 and b\.blocked_id = \$1/i)
  })

  it('only tags image media: a PDF or video attachment is skipped without touching members', async () => {
    const query = fakeQuery()
    const { createFeedRepository } = await import('./repository')
    const inserted = await createFeedRepository({ query }).insertPhotoTags(actorId, postId, [
      { storagePath: documentPath, profileIds: [friendId] },
    ])

    expect(inserted).toEqual([])
    const calls = callsOf(query)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toMatch(/mime_type like 'image\/%'/i)
    expect(calls[0]?.[1]).toEqual([postId, documentPath])
  })

  it('lets the author tag themselves without the mention check', async () => {
    const query = fakeQuery()
    const { createFeedRepository } = await import('./repository')
    const inserted = await createFeedRepository({ query }).insertPhotoTags(actorId, postId, [
      { storagePath: photoPath, profileIds: [actorId] },
    ])

    expect(inserted).toEqual([{ mediaId, profileId: actorId }])
    expect(callsOf(query).some(([sql]) => /as allowed/i.test(sql))).toBe(false)
  })

  it('deletes a tag only for the tagged member or the post author', async () => {
    const query = vi.fn(async (text: string) => /delete from public\.post_photo_tags/i.test(text) ? [{ id: friendId }] : [])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await expect(repository.deletePhotoTag(friendId, postId, mediaId, friendId)).resolves.toBe(true)
    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/using public\.posts p/i)
    expect(sql).toMatch(/tag\.post_id = \$2 and tag\.media_id = \$3 and tag\.tagged_profile_id = \$4/i)
    expect(sql).toMatch(/\$1 = tag\.tagged_profile_id or \$1 = p\.author_id/i)
    expect(values).toEqual([friendId, postId, mediaId, friendId])

    query.mockResolvedValueOnce([])
    await expect(repository.deletePhotoTag(blockedId, postId, mediaId, friendId)).resolves.toBe(false)
  })
})
