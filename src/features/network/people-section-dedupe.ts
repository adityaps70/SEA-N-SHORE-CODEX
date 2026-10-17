/**
 * Round H (H7): each person appears once on Discover. Sections keep their priority order
 * (Mutual connections first, then Shipmates, From your company, From your institute, Similar rank),
 * a person stays in the first section that lists them, and "More people you may know" only shows
 * people no section has. A section left empty is dropped.
 */
export function dedupePeopleSections<Key extends string, Profile extends { id: string }>(
  sections: ReadonlyArray<{ key: Key; profiles: readonly Profile[] }>,
  more: readonly Profile[],
): { sections: Array<{ key: Key; profiles: Profile[] }>; more: Profile[] } {
  const seen = new Set<string>()
  const keepUnseen = (profiles: readonly Profile[]) => profiles.filter((profile) => {
    if (seen.has(profile.id)) return false
    seen.add(profile.id)
    return true
  })
  const deduped = sections
    .map((entry) => ({ key: entry.key, profiles: keepUnseen(entry.profiles) }))
    .filter((entry) => entry.profiles.length > 0)
  return { sections: deduped, more: keepUnseen(more) }
}
