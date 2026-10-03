export function prioritizeRecentFeedRows<T>(
  rows: readonly T[],
  preferredAuthorIds: ReadonlySet<string>,
  authorId: (row: T) => string,
  /** Extra reason to lift a row, e.g. the viewer follows the organization it was posted as. */
  alsoPreferred: (row: T) => boolean = () => false,
): T[] {
  const preferred: T[] = []
  const other: T[] = []

  for (const row of rows) {
    if (preferredAuthorIds.has(authorId(row)) || alsoPreferred(row)) preferred.push(row)
    else other.push(row)
  }

  return [...preferred, ...other]
}
