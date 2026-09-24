import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('billing settings surface', () => {
  it('shows plan status without pretending checkout is configured', () => {
    const path = 'src/app/(app)/settings/billing/page.tsx'
    expect(existsSync(path)).toBe(true)
    const page = readFileSync(path, 'utf8')

    expect(page).toContain('Membership & billing')
    expect(page).toContain('Creator Pro')
    expect(page).toContain('Organization Pro')
    expect(page).toContain('getAccessContext')
    expect(page).toContain('payment provider')
    expect(page).toContain('/plans')
  })

  it('links Settings to membership and billing', () => {
    const settings = readFileSync('src/app/(app)/settings/page.tsx', 'utf8')
    expect(settings).toContain('/settings/billing')
    expect(settings).toContain('Membership & billing')
  })
})
