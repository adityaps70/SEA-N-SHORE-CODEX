import { describe, expect, it } from 'vitest'
import { buildFeedCursorFilter, feedNextCursor } from './queries'

describe('feed query helpers', () => {
  it('builds a strict created-at/id tie-break cursor', () => {
    expect(buildFeedCursorFilter({
      createdAt: '2026-09-02T10:00:00.000Z',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })).toBe(
      'created_at.lt.2026-09-02T10:00:00.000Z,and(created_at.eq.2026-09-02T10:00:00.000Z,id.lt.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)',
    )
  })

  it('anchors the next cursor to the original recency page tail', () => {
    const pageRows = [
      { id: 'p1', created_at: '2026-09-02T12:00:00.000Z' },
      { id: 'p2', created_at: '2026-09-02T11:00:00.000Z' },
      { id: 'p3', created_at: '2026-09-02T10:00:00.000Z' },
    ]

    expect(feedNextCursor(pageRows, true)).toEqual({
      createdAt: '2026-09-02T10:00:00.000Z',
      id: 'p3',
    })
    expect(feedNextCursor(pageRows, false)).toBeNull()
  })
})
