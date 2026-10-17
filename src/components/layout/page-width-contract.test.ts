import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Round H (H6): every page's outer content box uses one of the two shared widths, max-w-page-wide or
// max-w-page-narrow (tokens in src/app/globals.css, class names in ./page-width.ts). This scans the route files
// and the components that set a page's outer box, so a new page cannot quietly bring back a sixth width.

const ROUTE_FILES = /^(page|loading|not-found|error)\.tsx$/

/** Components (outside the route files) that render a page's outer content box. */
const PAGE_LEVEL_COMPONENTS = [
  'src/app/(app)/search/search-v2.tsx',
  'src/app/(public)/certificates/[verificationCode]/certificate-verification-view.tsx',
  'src/components/legal/legal-page.tsx',
  'src/features/learning/components/lms-skeletons.tsx',
  'src/features/newsletter/components/newsletter-link-page.tsx',
  'src/features/organizations/components/organization-manage-shell.tsx',
  'src/features/payments/components/payment-return-view.tsx',
]

/**
 * Justified exceptions, as `file::width`. Each one is not a page content column, so the two widths do not apply.
 * An entry that no longer matches anything fails the test, so the list cannot go stale.
 */
const ALLOWED: Record<string, string> = {
  // A single accept-or-decline card centred on the page; at a content width the card would stretch.
  'src/app/(app)/learn/company-invitations/[invitationId]/page.tsx::max-w-2xl': 'centred invitation card',
  // Standalone confirmation card outside the app shell, shown once after an account is deleted.
  'src/app/account-deleted/page.tsx::max-w-2xl': 'centred confirmation card',
  // One-link email landing pages: a single status card each.
  'src/app/(marketing)/email/unsubscribe/page.tsx::max-w-xl': 'centred status card',
  'src/app/(marketing)/email/learning/unsubscribe/page.tsx::max-w-xl': 'centred status card',
  'src/app/(marketing)/email/legacy/unsubscribe/page.tsx::max-w-xl': 'centred status card',
  'src/app/(marketing)/email/legacy/test-link/page.tsx::max-w-xl': 'centred status card',
  'src/features/newsletter/components/newsletter-link-page.tsx::max-w-xl': 'centred status card',
  'src/features/payments/components/payment-return-view.tsx::max-w-xl': 'centred payment status card',
  // Inner reading measure: the centred intro heading (and, on pricing, a notice) inside a page-wide plans box.
  'src/app/(app)/plans/page.tsx::max-w-3xl': 'centred intro inside the page-wide box',
  'src/app/(marketing)/pricing/page.tsx::max-w-3xl': 'centred intro and notice inside the page-wide box',
}

// An outer box: `mx-auto`, optionally followed by layout-only classes, then a max width. Paragraph measures such as
// `mx-auto mt-2 max-w-lg` have spacing classes in between and are not matched.
const CONTAINER = /mx-auto (?:(?:grid|flex|w-full|min-h-\[[^\]\s]+\]) )*(max-w-[^\s"'`]+)/g
const SHARED = new Set(['max-w-page-wide', 'max-w-page-narrow'])

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'api' ? [] : routeFiles(path)
    return ROUTE_FILES.test(entry.name) ? [path] : []
  })
}

const files = [...routeFiles('src/app'), ...PAGE_LEVEL_COMPONENTS]
const found = files.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(CONTAINER)].map((match) => ({ file, width: match[1] })),
)

describe('page width contract', () => {
  it('finds the page containers it is meant to police', () => {
    expect(found.filter(({ width }) => SHARED.has(width)).length).toBeGreaterThan(60)
  })

  it('uses only max-w-page-wide or max-w-page-narrow for a page’s outer box', () => {
    const offenders = found
      .filter(({ file, width }) => !SHARED.has(width) && !(`${file}::${width}` in ALLOWED))
      .map(({ file, width }) => `${file}: ${width}`)
    expect(offenders).toEqual([])
  })

  it('keeps every allow-list entry in use', () => {
    const used = new Set(found.map(({ file, width }) => `${file}::${width}`))
    expect(Object.keys(ALLOWED).filter((key) => !used.has(key))).toEqual([])
  })
})
