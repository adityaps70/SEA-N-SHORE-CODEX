import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('hiring mutation observability', () => {
  it('logs structured server-side database metadata while client errors remain safe', () => {
    const source = readFileSync('src/features/jobs/hiring-actions.ts', 'utf8')

    expect(source).toContain('hiring_mutation_failed')
    expect(source).toContain('console.error')
    expect(source).toMatch(/operation/)
    expect(source).toMatch(/code/)
    expect(source).toMatch(/constraint/)
    expect(source).toMatch(/table/)
    expect(source).toMatch(/column/)
    expect(source).toContain("return 'Something went wrong. Please try again.'")
  })
})
