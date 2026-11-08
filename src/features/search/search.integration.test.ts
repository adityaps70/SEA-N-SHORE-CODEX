import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createSearchRepository, SearchTimeoutError } from './search-repository'
import { createSearchService } from './search-service'

/**
 * Round G (G4) against the real schema (PGlite, every migration): search_documents is kept current
 * by triggers, and search finds typos and rank synonyms while never showing a blocked member or a
 * post the viewer may not see. Placeholder data only.
 */
let db: TestDatabase
let sequence = 0

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const query = (text: string, values?: readonly unknown[]) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
const repository = createSearchRepository({ transaction: (work) => work(query as never) })

async function member(fullName: string, extra: { roleKey?: string; headline?: string } = {}) {
  sequence += 1
  const rows = await db.query(
    `insert into public.profiles (id, full_name, slug, onboarding_completed_at, role_key, headline, profile_type)
     values (gen_random_uuid(), $1, $2, now(), $3, $4, 'seafarer') returning id`,
    [fullName, `placeholder-${sequence}`, extra.roleKey ?? null, extra.headline ?? null],
  )
  return rows[0]!.id as string
}

async function post(authorId: string, body: string, groupId: string | null = null) {
  const rows = await db.query(
    `insert into public.posts (author_id, body, category, group_id) values ($1, $2, 'maritime_news', $3) returning id`,
    [authorId, body, groupId],
  )
  return rows[0]!.id as string
}

const people = (hits: Array<{ kind: string; name: string }>) => hits.filter((hit) => hit.kind === 'person').map((hit) => hit.name)

beforeEach(async () => {
  for (const table of ['search_documents', 'post_hashtags', 'posts', 'community_group_memberships', 'community_groups', 'user_blocks', 'connections', 'jobs', 'maritime_profiles', 'profiles']) {
    await db.query(`delete from public.${table}`)
  }
})

describe('search (round G)', () => {
  it('never finds a load-test account or its posts for a real member (Round ARCH)', async () => {
    const viewer = await member('Placeholder Viewer')
    await member('Sachin Placeholder')
    const testAccount = await member('Sachin Loadtest')
    await db.query(`update public.profiles set is_load_test = true where id = $1`, [testAccount])
    await post(testAccount, 'Bunkering checklist from the load test')
    expect(people(await repository.search({ viewerId: viewer, query: 'Sachin', limits: { person: 5 } }))).toEqual(['Sachin Placeholder'])
    expect(await repository.search({ viewerId: viewer, query: 'bunkering', limits: { post: 5 } })).toEqual([])
  })

  it('a typo finds the person ("Sachn" finds Sachin)', async () => {
    const viewer = await member('Placeholder Viewer')
    await member('Sachin Placeholder')
    await member('Unrelated Placeholder')
    expect(people(await repository.search({ viewerId: viewer, query: 'Sachn', limits: { person: 5 } }))).toEqual(['Sachin Placeholder'])
  })

  it('one character matches names by prefix only; exact names rank first', async () => {
    const viewer = await member('Placeholder Viewer')
    await member('Ravi Placeholder', { headline: 'Rigger' })
    await member('Ravi')
    await member('Arun Placeholder', { headline: 'Rating' })
    expect(people(await repository.search({ viewerId: viewer, query: 'r', limits: { person: 5 } })).sort()).toEqual(['Ravi', 'Ravi Placeholder'])
    expect(people(await repository.search({ viewerId: viewer, query: 'ravi', limits: { person: 5 } }))[0]).toBe('Ravi')
  })

  it('a rank synonym finds the person ("2/O" and "C/E")', async () => {
    const viewer = await member('Placeholder Viewer')
    await member('Deck Placeholder', { roleKey: 'second_officer' })
    await member('Engine Placeholder', { roleKey: 'chief_engineer' })
    expect(people(await repository.search({ viewerId: viewer, query: '2/O', limits: { person: 5 } }))).toEqual(['Deck Placeholder'])
    expect(people(await repository.search({ viewerId: viewer, query: 'C/E', limits: { person: 5 } }))).toEqual(['Engine Placeholder'])
  })

  it('finds posts by stemmed text, author name and hashtag, newest first among equals', async () => {
    const viewer = await member('Placeholder Viewer')
    const author = await member('Writer Placeholder')
    const older = await post(author, 'Notes from the ship yard')
    await db.query(`update public.posts set created_at = now() - interval '2 days' where id = $1`, [older])
    await db.query(`select public.search_refresh_posts(array[$1::uuid])`, [older])
    const newer = await post(author, 'Two ships in port today')
    const ids = (await repository.search({ viewerId: viewer, query: 'ships', limits: { post: 5 } })).map((hit) => hit.id)
    expect(ids).toEqual([newer, older])
    expect((await repository.search({ viewerId: viewer, query: 'writer placeholder', limits: { post: 5 } })).length).toBe(2)
  })

  it('a post in a private community never shows to a non-member; members find it', async () => {
    const owner = await member('Owner Placeholder')
    const outsider = await member('Outsider Placeholder')
    const insider = await member('Insider Placeholder')
    const [group] = await db.query(
      `insert into public.community_groups (name, slug, visibility, created_by) values ('Private Placeholder Group', 'private-placeholder-group', 'private', $1) returning id`,
      [owner],
    )
    await db.query(`insert into public.community_group_memberships (group_id, profile_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'member', 'active')`, [group!.id, owner, insider])
    await post(owner, 'Confidential bunkering checklist', group!.id as string)
    expect(await repository.search({ viewerId: outsider, query: 'bunkering', limits: { post: 5 } })).toEqual([])
    expect((await repository.search({ viewerId: insider, query: 'bunkering', limits: { post: 5 } })).length).toBe(1)
  })

  it('a blocked member never appears, in either direction, nor do their posts', async () => {
    const viewer = await member('Placeholder Viewer')
    const blocked = await member('Blocked Placeholder')
    const blocker = await member('Blocker Placeholder')
    await post(blocked, 'Placeholder lashing tips')
    await post(blocker, 'Placeholder lashing advice')
    await db.query(`insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2), ($3, $1)`, [viewer, blocked, blocker])
    const hits = await repository.search({ viewerId: viewer, query: 'placeholder', limits: { person: 10, post: 10 } })
    expect(people(hits)).not.toContain('Blocked Placeholder')
    expect(people(hits)).not.toContain('Blocker Placeholder')
    expect((await repository.search({ viewerId: viewer, query: 'lashing', limits: { post: 10 } }))).toEqual([])
  })

  it('paginates with a stable order: pages never overlap and together cover every match', async () => {
    const viewer = await member('Placeholder Viewer')
    for (let index = 0; index < 25; index += 1) await member(`Marine Placeholder ${String(index).padStart(2, '0')}`)
    const service = createSearchService({ repository, sign: async (path) => path })
    const first = await service.page(viewer, 'marine', 'people', 1)
    const second = await service.page(viewer, 'marine', 'people', 2)
    expect(first.groups.person).toHaveLength(20)
    expect(first.hasMore).toBe(true)
    expect(second.groups.person).toHaveLength(5)
    expect(second.hasMore).toBe(false)
    const ids = [...first.groups.person!, ...second.groups.person!].map((hit) => hit.id)
    expect(new Set(ids).size).toBe(25)
    expect((await service.page(viewer, 'marine', 'people', 1)).groups.person!.map((hit) => hit.id)).toEqual(first.groups.person!.map((hit) => hit.id))
  })

  it('a document updates when a profile or job changes, and disappears when removed or hidden', async () => {
    const viewer = await member('Placeholder Viewer')
    const person = await member('Kumarswamy Initial')
    await db.query(`update public.profiles set full_name = 'Renamed Placeholder' where id = $1`, [person])
    expect(people(await repository.search({ viewerId: viewer, query: 'renamed', limits: { person: 5 } }))).toEqual(['Renamed Placeholder'])
    expect(people(await repository.search({ viewerId: viewer, query: 'kumarswamy', limits: { person: 5 } }))).toEqual([])
    await db.query(`update public.profiles set account_status = 'suspended' where id = $1`, [person])
    expect(people(await repository.search({ viewerId: viewer, query: 'renamed', limits: { person: 5 } }))).toEqual([])

    const [job] = await db.query(
      `insert into public.jobs (title, company_name, summary, description, status, created_by_user_id, published_at)
       values ('Placeholder Bosun', 'Placeholder Lines', 'Summary', 'Description', 'published', $1, now()) returning id`,
      [viewer],
    )
    expect((await repository.search({ viewerId: viewer, query: 'bosun', limits: { job: 5 } })).map((hit) => hit.name)).toEqual(['Placeholder Bosun'])
    await db.query(`update public.jobs set title = 'Placeholder Fitter' where id = $1`, [job!.id])
    expect((await repository.search({ viewerId: viewer, query: 'fitter', limits: { job: 5 } })).map((hit) => hit.name)).toEqual(['Placeholder Fitter'])
    await db.query(`update public.jobs set deleted_at = now() where id = $1`, [job!.id])
    expect(await repository.search({ viewerId: viewer, query: 'fitter', limits: { job: 5 } })).toEqual([])
    const [row] = await db.query(`select visibility from public.search_documents where kind = 'job' and entity_id = $1`, [job!.id])
    expect(row!.visibility).toBe('hidden')
  })

  it('"chief eng" ranks Chief Engineer people and jobs above Chief Officer ones, whatever the social boosts (round H, H7)', async () => {
    const viewer = await member('Placeholder Viewer')
    // A connected Chief Officer whose headline also matches the words "chief" and "eng…".
    const officer = await member('Officer Placeholder', { roleKey: 'chief_officer', headline: 'Chief Officer | English and engine room liaison' })
    await member('Engineer Placeholder', { roleKey: 'chief_engineer' })
    await member('Headline Placeholder', { headline: 'Chief Engineer at Placeholder Lines' })
    const [low, high] = [viewer, officer].sort()
    await db.query(`insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $1, 'accepted')`, [low, high])

    const ranked = people(await repository.search({ viewerId: viewer, query: 'chief eng', limits: { person: 5 } }))
    expect(ranked.slice(0, 2).sort()).toEqual(['Engineer Placeholder', 'Headline Placeholder'])
    expect(ranked.indexOf('Officer Placeholder')).toBeGreaterThan(1)

    // The Chief Officer job is newer and its title is a close typo match; the Chief Engineer job is titled "C/E".
    await db.query(
      `insert into public.jobs (title, company_name, summary, description, status, created_by_user_id, published_at, accepted_role_keys)
       values ('C/E for LNG carrier', 'Placeholder Lines', 'Summary', 'Description', 'published', $1, now() - interval '2 days', array['chief_engineer']),
              ('Chief Officer', 'Placeholder Lines', 'English speaking chief officer', 'Engine and deck coordination', 'published', $1, now(), array['chief_officer'])`,
      [viewer],
    )
    const jobs = (await repository.search({ viewerId: viewer, query: 'chief eng', limits: { job: 5 } })).map((hit) => hit.name)
    expect(jobs[0]).toBe('C/E for LNG carrier')
    // The dropdown (names and rank synonyms only) agrees.
    const dropdown = (await repository.search({ viewerId: viewer, query: 'chief eng', limits: { job: 2, person: 3 }, fullText: false }))
    expect(dropdown.find((hit) => hit.kind === 'job')?.name).toBe('C/E for LNG carrier')
    expect(dropdown.find((hit) => hit.kind === 'person')?.name).not.toBe('Officer Placeholder')
  })

  it('maps a statement timeout to SearchTimeoutError', async () => {
    const timingOut = createSearchRepository({ transaction: async () => { throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }) } })
    await expect(timingOut.search({ viewerId: '00000000-0000-4000-8000-000000000001', query: 'placeholder', limits: { person: 3 } })).rejects.toBeInstanceOf(SearchTimeoutError)
  })
})
