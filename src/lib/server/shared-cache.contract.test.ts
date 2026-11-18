import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Round CAP (shared cache, owner-approved 13 Nov): only data that is the same for every viewer. Every use is listed
 * here; its cache key and loader take no viewer, member, permission or session input.
 */
const SHARED_CACHES: Record<string, string[]> = {
  'src/features/hashtags/repository.ts': ['hashtag_suggestions'],
  'src/features/community/category-repository.ts': ['community_directory_chips'],
  'src/features/learning/marketplace-repository.ts': ['published_courses'],
  'src/features/site-settings/queries.ts': ['member_numbers'],
  'src/features/site-settings/share-settings.ts': ['share_settings'],
  // Round GP: Admin › Members by country (counts only, read after the permission check).
  'src/features/countries/admin-country-repository.ts': ['admin_country_stats', 'admin_country_detail'],
}
const PERSONAL = /viewer|profileId|userId|memberId|session|cookies\(|headers\(|requireAwsUser|requireUser|getAwsVerifiedUser|role/i

describe('shared in-process caches', () => {
  it('are only the listed ones', () => {
    const files = execSync("grep -rl --include='*.ts' 'createSharedCache' src", { encoding: 'utf8' }).trim().split('\n')
      .filter((file) => !file.startsWith('src/lib/server/')).sort()
    expect(files).toEqual(Object.keys(SHARED_CACHES).sort())
  })

  it.each(Object.entries(SHARED_CACHES))('%s caches viewer-independent reads only', (file, names) => {
    const source = readFileSync(file, 'utf8')
    for (const name of names) {
      const at = source.indexOf(`name: '${name}'`)
      expect(at).toBeGreaterThan(0)
    }
    // Each cached read: the cache.get(...) call and its key take nothing personal.
    for (const call of source.matchAll(/Cache\.get\(([^\n]*)/g)) expect(call[1]).not.toMatch(PERSONAL)
  })
})
