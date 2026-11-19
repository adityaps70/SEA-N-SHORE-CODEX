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
const COUNTRY_ADMIN_ENTRY_POINTS = [
  'src/app/(app)/admin/countries/[country]/page.tsx',
  'src/app/(app)/admin/countries/page.tsx',
  'src/app/(app)/admin/layout.tsx',
  'src/app/(app)/admin/organizations/[applicationId]/page.tsx',
  'src/app/(app)/admin/organizations/page.tsx',
  'src/app/(app)/admin/page.tsx',
]

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
    expect(readFileSync(join(root, path), 'utf8')).toMatch(/requireAdminAccess\('(platform|country)'\)/)
  })

  it('lets country admins into the organization review and country pages only', () => {
    const countryPages = entryPoints.filter((path) => readFileSync(join(root, path), 'utf8').includes("requireAdminAccess('country')"))
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
