export function prioritizeRecentFeedRows<T>(
  rows: readonly T[],
  preferredAuthorIds: ReadonlySet<string>,
  authorId: (row: T) => string,
): T[] {
  const preferred: T[] = []
  const other: T[] = []

  for (const row of rows) {
    if (preferredAuthorIds.has(authorId(row))) preferred.push(row)
    else other.push(row)
  }

  return [...preferred, ...other]
}
