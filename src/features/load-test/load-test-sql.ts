/**
 * Round ARCH (Phase 1): the 50 load-test accounts (profiles.is_load_test) exist only for the repeatable load test.
 * Real members never see them: not in people you may know, search, feeds, counts, notifications, emails or analytics.
 * They only see each other.
 */

/** SQL true when author `authorAlias` is a real member, or when the viewer (`viewerParam`) is a load-test account too. */
export function loadTestAuthorVisibleSql(authorAlias: string, viewerParam: string) {
  return `(not ${authorAlias}.is_load_test or exists (
      select 1 from public.profiles load_test_viewer where load_test_viewer.id = ${viewerParam} and load_test_viewer.is_load_test
    ))`
}

/** SQL true when the profile with id `profileIdSql` is a load-test account. */
export function isLoadTestProfileSql(profileIdSql: string) {
  return `exists (select 1 from public.profiles load_test_profile where load_test_profile.id = ${profileIdSql} and load_test_profile.is_load_test)`
}
