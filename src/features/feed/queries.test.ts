import { describe, expect, it } from 'vitest'
import { buildFeedCursorFilter } from './queries'

describe('buildFeedCursorFilter', () => {
  it('builds a strict created-at/id tie-break cursor', () => {
    expect(buildFeedCursorFilter({
      createdAt: '2026-09-02T10:00:00.000Z',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })).toBe(
      'created_at.lt.2026-09-02T10:00:00.000Z,and(created_at.eq.2026-09-02T10:00:00.000Z,id.lt.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)',
    )
  })
})
