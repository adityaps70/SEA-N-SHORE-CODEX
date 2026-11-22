import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Round GP (Part C): country admins are default-deny. Every Admin page checks access itself (client navigation does
 * not re-render the layout), and only these pages let a country admin in. Every /api/admin route stays for platform
 * administrators only. Adding a page to this list is a decision: say why in the PR.
 */
const root = process.cwd()
const adminDirectory = join(root, 'src/app/(app)/admin')
// Round GP Part E: each country admin entry point and the area it checks ('console' = any country admin with a
// section; otherwise the section that must have been given to them).
const COUNTRY_ADMIN_ENTRY_POINTS: Record<string, string> = {
  'src/app/(app)/admin/countries/[country]/page.tsx': 'members',
  'src/app/(app)/admin/countries/page.tsx': 'members',
  'src/app/(app)/admin/layout.tsx': 'console',
  'src/app/(app)/admin/organizations/[applicationId]/page.tsx': 'organizations',
  'src/app/(app)/admin/organizations/page.tsx': 'organizations',
  'src/app/(app)/admin/page.tsx': 'console',
  // Round GP Part E (E2).
  'src/app/(app)/admin/verifications/page.tsx': 'verification',
  'src/app/(app)/admin/access/page.tsx': 'access',
  // Round GP Part E (E3).
  'src/app/(app)/admin/learning/page.tsx': 'learning',
  'src/app/(app)/admin/learning/courses/page.tsx': 'learning',
  // Round GP Part E (E4).
  'src/app/(app)/admin/moderation/page.tsx': 'moderation',
  'src/app/(app)/admin/events/page.tsx': 'events',
  // Round GP Part E (E5).
  'src/app/(app)/admin/communities/page.tsx': 'communities',
}
const AREA = /requireAdminAccess\('([a-z]+)'\)/

function files(directory: string, pattern: RegExp): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return files(path, pattern)
    return pattern.test(entry) ? [relative(root, path)] : []
  })
}

describe('Admin access for country admins (Round GP, Part C)', () => {
  const entryPoints = files(adminDirectory, /^(page|layout)\.tsx$/).sort()

  it.each(entryPoints)('%s checks admin access itself', (path) => {
    expect(readFileSync(join(root, path), 'utf8')).toMatch(/requireAdminAccess\('(platform|console|overview|organizations|members|learning|events|moderation|communities|verification|access)'\)/)
  })

  it('lets country admins into the listed pages only, each checking its own section', () => {
    const countryPages = Object.fromEntries(entryPoints.flatMap((path) => {
      const area = readFileSync(join(root, path), 'utf8').match(AREA)?.[1]
      return area && area !== 'platform' ? [[path, area]] : []
    }))
    expect(countryPages).toEqual(COUNTRY_ADMIN_ENTRY_POINTS)
  })

  it('has no other server entry points under /admin', () => {
    expect(files(adminDirectory, /^route\.tsx?$/)).toEqual([])
  })

  it('keeps every /api/admin route for platform administrators only', () => {
    const routes = files(join(root, 'src/app/api/admin'), /^route\.ts$/)
    expect(routes.length).toBeGreaterThan(0)
    for (const path of routes) {
      const source = readFileSync(join(root, path), 'utf8')
      expect(source, path).toContain('requirePlatformAdministratorUser')
      expect(source, path).not.toContain('requireAdminAccess')
    }
  })
})
