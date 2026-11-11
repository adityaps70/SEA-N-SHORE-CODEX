import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createFeedRepository } from './repository'
import type { FeedCommentRow } from './mappers'

/**
 * Round DB (Deploy C) against the real schema (PGlite, every migration): the "newest comments" preview gives each post
 * card exactly what loading every comment gave it on first render: the comment the thread shows first and its replies,
 * the phone preview, and the "View N more comments" count. Placeholder data only.
 */
let db: TestDatabase
const query = (text: string, values?: readonly unknown[]) => db.query(text, values)

async function profile(name: string) {
  const [row] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [name])
  return String(row!.id)
}

let minute = 0
async function comment(postId: string, authorId: string, options: { parent?: string; deleted?: boolean; sameTimeAs?: string } = {}) {
  minute += 1
  const [row] = await db.query(
    `insert into public.post_comments (post_id, author_id, body, parent_comment_id, created_at, deleted_at)
     values ($1, $2, 'Placeholder comment', $3,
       coalesce((select created_at from public.post_comments where id = $5::uuid), timestamptz '2026-11-01 00:00:00+00' + make_interval(mins => $4::int)),
       case when $6::boolean then now() end)
     returning id`,
    [postId, authorId, options.parent ?? null, minute, options.sameTimeAs ?? null, options.deleted ?? false],
  )
  return String(row!.id)
}

/** What a post card shows first, from the rows it was given (comment-thread.tsx and post-card.tsx topComment). */
function firstRender(rows: FeedCommentRow[], rootCount?: number) {
  const roots = rows.filter((row) => !row.parent_comment_id).slice().reverse()
  const first = roots[0]
  return {
    threadFirst: first?.id ?? null,
    replies: first ? rows.filter((row) => row.parent_comment_id === first.id && !row.deleted_at).map((row) => row.id) : [],
    phone: rows.filter((row) => !row.parent_comment_id && !row.deleted_at).at(-1)?.id ?? null,
    moreComments: Math.max(0, (rootCount ?? roots.length) - (first ? 1 : 0)),
  }
}

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('the newest comments preview (shadow comparison with loading every comment)', () => {
  it('shows every kind of post exactly as the full load did, while loading fewer rows', async () => {
    const author = await profile('Placeholder Author')
    const viewer = await profile('Placeholder Viewer')
    const others = await Promise.all(['A', 'B', 'C'].map((n) => profile(`Placeholder ${n}`)))
    const posts: string[] = []
    for (let n = 0; n < 7; n += 1) {
      const [row] = await db.query(`insert into public.posts (author_id, body, category) values ($1, 'Placeholder post', 'maritime_news') returning id`, [author])
      posts.push(String(row!.id))
    }
    const [none, single, threaded, removedNewest, removedHidden, ties, busy] = posts as [string, string, string, string, string, string, string]
    void none
    await comment(single, others[0]!)
    // Several roots; the newest has three replies (one removed), an older one has its own reply.
    const old = await comment(threaded, others[0]!)
    await comment(threaded, others[1]!, { parent: old })
    const newest = await comment(threaded, others[2]!)
    await comment(threaded, others[0]!, { parent: newest })
    await comment(threaded, others[1]!, { parent: newest, deleted: true })
    await comment(threaded, viewer, { parent: newest })
    // The newest root was removed but keeps a live reply: the thread shows it first, the phone shows the older live one.
    await comment(removedNewest, others[0]!)
    const removed = await comment(removedNewest, others[1]!, { deleted: true })
    await comment(removedNewest, others[2]!, { parent: removed })
    // A removed root with no live reply is not shown at all.
    const live = await comment(removedHidden, others[0]!)
    await comment(removedHidden, others[1]!, { deleted: true })
    void live
    // Two roots at the same instant: the tie is broken by id, as in the full load.
    const tie = await comment(ties, others[0]!)
    await comment(ties, others[1]!, { sameTimeAs: tie })
    // Many roots and replies.
    for (let n = 0; n < 15; n += 1) {
      const root = await comment(busy, others[n % 3]!)
      if (n % 4 === 0) await comment(busy, others[(n + 1) % 3]!, { parent: root })
    }

    const repository = createFeedRepository({ query })
    const full = await repository.getComments(posts, viewer)
    const preview = await repository.getNewestCommentPreview(posts, viewer)
    let fullRows = 0
    let previewRows = 0
    for (const post of posts) {
      const fullPost = full.filter((row) => row.post_id === post)
      const previewPost = preview.rows.filter((row) => row.post_id === post)
      const counts = preview.counts.get(post) ?? { roots: 0, total: 0 }
      expect(firstRender(previewPost, counts.roots), post).toEqual(firstRender(fullPost))
      // The counts are those of the full load, and complete means every row is there.
      expect(counts).toEqual({ roots: fullPost.filter((row) => !row.parent_comment_id).length, total: fullPost.length })
      if (previewPost.length >= counts.total) expect(previewPost.map((row) => row.id)).toEqual(fullPost.map((row) => row.id))
      // The rows that are loaded are the very rows of the full load (same order, same content).
      expect(previewPost).toEqual(fullPost.filter((row) => previewPost.some((p) => p.id === row.id)))
      fullRows += fullPost.length
      previewRows += previewPost.length
    }
    expect(firstRender(preview.rows.filter((row) => row.post_id === removedNewest), 2).threadFirst).toBe(removed)
    expect(previewRows).toBeLessThan(fullRows)
    expect(await repository.getNewestCommentPreview([], viewer)).toEqual({ rows: [], counts: new Map() })
  })
})
