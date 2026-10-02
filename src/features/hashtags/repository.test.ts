import { describe, expect, it, vi } from 'vitest'
import { createHashtagRepository } from './repository'

type QueryCall = [text: string, values?: readonly unknown[]]

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

const profileId = '11111111-1111-4111-8111-111111111111'

describe('hashtag repository', () => {
  it('suggests existing tags by prefix, most used first, escaping LIKE wildcards', async () => {
    const query = vi.fn(async () => [
      { tag: 'life_at_sea', post_count: '12' },
      { tag: 'life_boat', post_count: 3 },
    ])
    const repository = createHashtagRepository({ query })

    await expect(repository.searchHashtags('#Life_')).resolves.toEqual([
      { tag: 'life_at_sea', postCount: 12 },
      { tag: 'life_boat', postCount: 3 },
    ])
    const [sql, values] = callsOf(query)[0]!
    const normalized = sql.replace(/\s+/g, ' ')
    expect(normalized).toContain('from public.hashtags h')
    expect(normalized).toContain("h.tag like $1 escape '\\'")
    expect(normalized).toContain('p.deleted_at is null and p.group_id is null')
    expect(normalized).toContain('order by post_count desc, h.tag asc')
    expect(values).toEqual(['life\\_%', 8])
  })

  it('lists the most used tags for an empty query and rejects tags the database would not accept', async () => {
    const query = vi.fn(async () => [{ tag: 'safety', post_count: 40 }])
    const repository = createHashtagRepository({ query })

    await expect(repository.searchHashtags('', 3)).resolves.toEqual([{ tag: 'safety', postCount: 40 }])
    expect(callsOf(query)[0]![1]).toEqual(['%', 3])

    await expect(repository.searchHashtags('ünïcode')).resolves.toEqual([])
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('summarises a tag with live public post and follower counts', async () => {
    const query = vi.fn(async () => [{ tag: 'sire', post_count: '5', follower_count: 2 }])
    const repository = createHashtagRepository({ query })

    await expect(repository.getHashtagSummary('#SIRE')).resolves.toEqual({ tag: 'sire', postCount: 5, followerCount: 2 })
    const [sql, values] = callsOf(query)[0]!
    expect(sql.replace(/\s+/g, ' ')).toContain('from public.hashtag_follows hf where hf.hashtag_id = h.id')
    expect(values).toEqual(['sire'])
  })

  it('counts legacy posts whose hashtag link row is missing by matching the post body', async () => {
    const query = vi.fn(async () => [{ tag: 'sire', post_count: '1', follower_count: 0 }])
    const repository = createHashtagRepository({ query })

    await expect(repository.getHashtagSummary('sire')).resolves.toEqual({ tag: 'sire', postCount: 1, followerCount: 0 })
    const [sql, values] = callsOf(query)[0]!
    expect(sql).toMatch(/p\.body ~\* \$2/i)
    expect(values?.[0]).toBe('sire')
    expect(values?.[1]).toBe('(^|[[:space:](\\\\[\\{\\\'"“‘])#sire([^[:alnum:]_]|$)')
  })

  it('returns null for unknown or invalid tags', async () => {
    const query = vi.fn(async () => [])
    const repository = createHashtagRepository({ query })
    await expect(repository.getHashtagSummary('nothing')).resolves.toBeNull()
    await expect(repository.getHashtagSummary('not a tag')).resolves.toBeNull()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('follows a tag, creating the tag row first, and unfollows through the tag name', async () => {
    const query = vi.fn(async () => [])
    const repository = createHashtagRepository({ query })

    await expect(repository.followHashtag(profileId, '#Vetting')).resolves.toBe(true)
    const calls = callsOf(query)
    expect(calls[0]![0]).toContain('insert into public.hashtags (tag) values ($1) on conflict (tag) do nothing')
    expect(calls[0]![1]).toEqual(['vetting'])
    expect(calls[1]![0].replace(/\s+/g, ' ')).toContain('insert into public.hashtag_follows (profile_id, hashtag_id) select $1, h.id from public.hashtags h where h.tag = $2')
    expect(calls[1]![1]).toEqual([profileId, 'vetting'])

    await expect(repository.unfollowHashtag(profileId, 'vetting')).resolves.toBe(true)
    expect(calls[2]![0].replace(/\s+/g, ' ')).toContain('delete from public.hashtag_follows hf using public.hashtags h')
    expect(calls[2]![1]).toEqual([profileId, 'vetting'])

    await expect(repository.followHashtag(profileId, 'bad tag')).resolves.toBe(false)
    expect(query).toHaveBeenCalledTimes(3)
  })

  it('reports whether the member follows a tag', async () => {
    const query = vi.fn(async () => [{ following: true }])
    const repository = createHashtagRepository({ query })
    await expect(repository.isFollowingHashtag(profileId, 'sire')).resolves.toBe(true)
    expect(callsOf(query)[0]![1]).toEqual([profileId, 'sire'])

    const empty = createHashtagRepository({ query: vi.fn(async () => []) })
    await expect(empty.isFollowingHashtag(profileId, 'sire')).resolves.toBe(false)
    await expect(empty.isFollowingHashtag(profileId, '')).resolves.toBe(false)
  })
})
