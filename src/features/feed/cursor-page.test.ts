import { describe, expect, it } from 'vitest'
import { appendCursorPage, compareFeedCursor, mergeRefreshedFirstPage, sameFeedCursor, type CursorListState } from './cursor-page'
import type { CursorPage, CursorPageEntry, FeedCursor } from './types'

type Item = { id: string }
const getId = (item: Item) => item.id

/** Entry n: newer for larger n; ids are fixed-width so text order matches. */
function entry(n: number): CursorPageEntry<Item> {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  return { cursor: { createdAt: `2026-09-05T07:00:${String(n).padStart(2, '0')}.000000Z`, id }, item: { id } }
}

function page(numbers: number[], next: FeedCursor | null): CursorPage<Item> {
  return { entries: numbers.map(entry), nextCursor: next }
}

const ids = (state: CursorListState<Item>) => state.entries.map((item) => Number(item.item.id.slice(-12)))

describe('keyset cursor helpers (Round 14, 3.7)', () => {
  it('orders positions newest first by time, then id', () => {
    expect(compareFeedCursor(entry(1).cursor, entry(2).cursor)).toBeLessThan(0)
    expect(compareFeedCursor(entry(2).cursor, entry(1).cursor)).toBeGreaterThan(0)
    const sameTime = { createdAt: entry(1).cursor.createdAt, id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }
    expect(compareFeedCursor(entry(1).cursor, sameTime)).toBeLessThan(0)
    expect(compareFeedCursor(entry(1).cursor, { ...entry(1).cursor })).toBe(0)
  })

  it('compares cursors by value', () => {
    expect(sameFeedCursor(entry(1).cursor, { ...entry(1).cursor })).toBe(true)
    expect(sameFeedCursor(entry(1).cursor, entry(2).cursor)).toBe(false)
    expect(sameFeedCursor(null, null)).toBe(true)
    expect(sameFeedCursor(entry(1).cursor, null)).toBe(false)
  })
})

describe('appendCursorPage', () => {
  it('appends new entries and moves the cursor', () => {
    const state = { entries: page([9, 8], null).entries, cursor: entry(8).cursor }
    const next = appendCursorPage(state, entry(8).cursor, page([7, 6], entry(6).cursor), getId)
    expect(ids(next)).toEqual([9, 8, 7, 6])
    expect(next.cursor).toEqual(entry(6).cursor)
  })

  it('skips entries already shown and ends on the last page', () => {
    const state = { entries: page([9, 8], null).entries, cursor: entry(8).cursor }
    const next = appendCursorPage(state, entry(8).cursor, page([8, 7], null), getId)
    expect(ids(next)).toEqual([9, 8, 7])
    expect(next.cursor).toBeNull()
  })

  it('ends the list when a page adds nothing or the cursor did not move', () => {
    const state = { entries: page([9, 8], null).entries, cursor: entry(8).cursor }
    expect(appendCursorPage(state, entry(8).cursor, page([9, 8], entry(7).cursor), getId).cursor).toBeNull()
    expect(appendCursorPage(state, entry(8).cursor, page([7], entry(8).cursor), getId).cursor).toBeNull()
  })
})

describe('mergeRefreshedFirstPage (no stale rows after an action)', () => {
  it('drops a deleted first-page entry and keeps the pages already loaded', () => {
    const first = page([9, 8, 7], entry(7).cursor)
    const state = { entries: [...first.entries, ...page([6, 5, 4], null).entries], cursor: entry(4).cursor }
    // 8 was deleted: the fresh first page pulls 6 up.
    const refreshed = page([9, 7, 6], entry(6).cursor)

    const next = mergeRefreshedFirstPage(state, first, refreshed, getId)

    expect(ids(next)).toEqual([9, 7, 6, 5, 4])
    expect(next.cursor).toEqual(entry(4).cursor)
  })

  it('keeps an entry pushed off the first page by a newer one', () => {
    const first = page([9, 8, 7], entry(7).cursor)
    const state = { entries: [...first.entries, ...page([6], null).entries], cursor: entry(6).cursor }
    const refreshed = page([10, 9, 8], entry(8).cursor)

    expect(ids(mergeRefreshedFirstPage(state, first, refreshed, getId))).toEqual([10, 9, 8, 7, 6])
  })

  it('moves the next page to the fresh tail when nothing more was loaded yet', () => {
    const first = page([9, 8, 7], entry(7).cursor)
    const state = { entries: first.entries, cursor: first.nextCursor }
    const refreshed = page([9, 7, 6], entry(6).cursor)

    const next = mergeRefreshedFirstPage(state, first, refreshed, getId)

    expect(ids(next)).toEqual([9, 7, 6])
    expect(next.cursor).toEqual(entry(6).cursor)
  })

  it('shows only the fresh page when everything now fits on it', () => {
    const first = page([9, 8, 7], entry(7).cursor)
    const state = { entries: [...first.entries, ...page([6], null).entries], cursor: null }

    const next = mergeRefreshedFirstPage(state, first, page([9, 6], null), getId)

    expect(ids(next)).toEqual([9, 6])
    expect(next.cursor).toBeNull()
  })
})
