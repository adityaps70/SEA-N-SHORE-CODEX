import type { CursorPage, CursorPageEntry, FeedCursor } from './types'

/** What a "Load more" list shows: every entry so far and where the next page starts (null: the end). */
export type CursorListState<T> = {
  entries: CursorPageEntry<T>[]
  cursor: FeedCursor | null
}

export function sameFeedCursor(left: FeedCursor | null, right: FeedCursor | null) {
  if (!left || !right) return left === right
  return left.createdAt === right.createdAt && left.id === right.id
}

/**
 * Newest-first order of two keyset positions: negative when `left` is older (sorts after `right`).
 * Timestamps are the repository's fixed-width UTC text (microseconds), so they compare as text;
 * ids are lower-case UUIDs, which compare as text the way Postgres orders uuid values.
 */
export function compareFeedCursor(left: FeedCursor, right: FeedCursor) {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

/**
 * Appends a loaded page, skipping entries already shown. A page that adds nothing new, or a cursor
 * that did not move, ends the list (the same rule as the home feed).
 */
export function appendCursorPage<T>(
  state: CursorListState<T>,
  requested: FeedCursor,
  page: CursorPage<T>,
  getId: (item: T) => string,
): CursorListState<T> {
  const shown = new Set(state.entries.map((entry) => getId(entry.item)))
  const added = page.entries.filter((entry) => !shown.has(getId(entry.item)))
  const moved = page.nextCursor !== null && !sameFeedCursor(page.nextCursor, requested)
  return {
    entries: added.length ? [...state.entries, ...added] : state.entries,
    cursor: moved && added.length ? page.nextCursor : null,
  }
}

/**
 * The server re-rendered the first page (after an action revalidated the route). The fresh first
 * page replaces the old one; entries loaded with "Load more" stay when they are older than the new
 * first page's tail. Anything newer than that tail that is missing from the fresh page was deleted
 * or hidden, so it goes. When the member had not loaded more yet, the next page starts at the new tail.
 */
export function mergeRefreshedFirstPage<T>(
  state: CursorListState<T>,
  previousFirstPage: CursorPage<T>,
  nextFirstPage: CursorPage<T>,
  getId: (item: T) => string,
): CursorListState<T> {
  const tail = nextFirstPage.nextCursor
  if (!tail) return { entries: nextFirstPage.entries, cursor: null }
  const firstPageIds = new Set(nextFirstPage.entries.map((entry) => getId(entry.item)))
  const older = state.entries.filter((entry) => !firstPageIds.has(getId(entry.item)) && compareFeedCursor(entry.cursor, tail) < 0)
  const stillOnFirstPage = sameFeedCursor(state.cursor, previousFirstPage.nextCursor)
  return {
    entries: [...nextFirstPage.entries, ...older],
    cursor: stillOnFirstPage ? tail : state.cursor,
  }
}
