import { describe, expect, it } from 'vitest'
import { prioritizeRecentFeedRows } from './ranking'

describe('prioritizeRecentFeedRows', () => {
  it('stable-partitions one recency-bounded page without mutating the source', () => {
    const rows = [
      { id: 'p1', authorId: 'a1' },
      { id: 'p2', authorId: 'a2' },
      { id: 'p3', authorId: 'a3' },
      { id: 'p4', authorId: 'a4' },
    ] as const
    const snapshot = [...rows]

    const ranked = prioritizeRecentFeedRows(rows, new Set(['a2', 'a4']), (row) => row.authorId)

    expect(ranked.map((row) => row.id)).toEqual(['p2', 'p4', 'p1', 'p3'])
    expect(rows).toEqual(snapshot)
  })
})
