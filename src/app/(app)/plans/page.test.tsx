import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const path = 'src/app/(app)/plans/page.tsx'

describe('membership plans page contract', () => {
  it('presents the three simple Sea N Shore plans and separates payment from verification', () => {
    expect(existsSync(path)).toBe(true)
    const page = readFileSync(path, 'utf8')

    expect(page).toContain('Sea N Shore Member')
    expect(page).toContain('FREE')
    expect(page).toContain('Creator Pro')
    expect(page).toContain('Organization Pro')
    expect(page).toContain('Post Jobs')
    expect(page).toContain('Create Events')
    expect(page).toContain('Create Courses / LMS')
    expect(page).toContain('Multiple admins')
    expect(page).toContain('Applicant management')
    expect(page).toContain('Student management')
    expect(page).toContain('Company verification')
    expect(page).toContain('Verification and payment are separate')
  })
})
