import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createNetworkRepository } from './repository'
import { relationshipFromRows } from './queries'

/**
 * Round DB (Deploy C) against the real schema (PGlite, every migration): the bounded graph read (only the rows between
 * the viewer and the given members) gives exactly the answers the whole-graph read gave, for a profile's relationship
 * and for the recent feed's preferred authors on a page. Placeholder data only.
 */
let db: TestDatabase
const query = (text: string, values?: readonly unknown[]) => db.query(text, values)

async function profile(name: string) {
  const [row] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [name])
  return String(row!.id)
}

async function connect(a: string, b: string, requestedBy: string, status: 'pending' | 'accepted') {
  const [low, high] = a < b ? [a, b] : [b, a]
  await db.query(
    `insert into public.connections (user_low_id, user_high_id, requested_by, status) values ($1, $2, $3, $4::public.connection_status)`,
    [low, high, requestedBy, status],
  )
}

async function follow(follower: string, following: string) {
  await db.query(`insert into public.follows (follower_id, following_id) values ($1, $2)`, [follower, following])
}

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('bounded graph reads (shadow comparison with the whole-graph read)', () => {
  it('give every relationship and every preferred author exactly as before', async () => {
    const network = createNetworkRepository({ query })
    const viewer = await profile('Placeholder Viewer')
    const kinds = ['stranger', 'followed', 'connected', 'connected-followed', 'outgoing', 'incoming', 'follows-viewer'] as const
    const members: Record<string, string> = {}
    for (const kind of kinds) members[kind] = await profile(`Placeholder ${kind}`)
    await follow(viewer, members.followed!)
    await connect(viewer, members.connected!, members.connected!, 'accepted')
    await connect(viewer, members['connected-followed']!, viewer, 'accepted')
    await follow(viewer, members['connected-followed']!)
    await connect(viewer, members.outgoing!, viewer, 'pending')
    await connect(viewer, members.incoming!, members.incoming!, 'pending')
    await follow(members['follows-viewer']!, viewer)
    // Other members' graph, which must never leak into the viewer's answers.
    const other = await profile('Placeholder Other')
    await follow(other, members.stranger!)
    await connect(other, members.stranger!, other, 'accepted')

    const whole = await network.loadViewerGraph(viewer)
    const targets = [...Object.values(members), other, viewer]
    for (const target of targets) {
      const bounded = await network.loadViewerGraphWith(viewer, [target])
      expect(relationshipFromRows(viewer, target, bounded.followedIds, bounded.connections)).toEqual(
        relationshipFromRows(viewer, target, whole.followedIds, whole.connections),
      )
    }
    // The kinds come out as named (the comparison above is not trivially all "none").
    const kindOf = async (target: string) => {
      const bounded = await network.loadViewerGraphWith(viewer, [target])
      return relationshipFromRows(viewer, target, bounded.followedIds, bounded.connections)
    }
    expect((await kindOf(members.connected!)).connection.kind).toBe('connected')
    expect((await kindOf(members.outgoing!)).connection.kind).toBe('outgoing_pending')
    expect((await kindOf(members.incoming!)).connection.kind).toBe('incoming_pending')
    expect((await kindOf(members.followed!)).following).toBe(true)

    // The recent feed's preferred authors: followed members and accepted connections, as before, among the page's
    // authors (with repeats, the viewer and unrelated members on the page).
    const preferred = (graph: Awaited<ReturnType<typeof network.loadViewerGraph>>) => {
      const set = new Set(graph.followedIds)
      for (const row of graph.connections) if (row.status === 'accepted') set.add(row.user_low_id === viewer ? row.user_high_id : row.user_low_id)
      return set
    }
    const page = [members.stranger!, members.connected!, members.connected!, members.followed!, members.outgoing!, viewer, other, members['connected-followed']!]
    const before = [...preferred(whole)].filter((id) => page.includes(id)).sort()
    const after = [...preferred(await network.loadViewerGraphWith(viewer, page))].sort()
    expect(after).toEqual(before)
    expect(after).toEqual([members.connected!, members['connected-followed']!, members.followed!].sort())
    // No authors: nothing to look up.
    expect(await network.loadViewerGraphWith(viewer, [])).toEqual({ followedIds: new Set(), connections: [] })
  })
})
