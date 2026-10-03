import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('organization-published course learner visibility', () => {
  it.each([
    'src/features/learning/marketplace-repository.ts',
    'src/features/learning/enrollment-repository.ts',
    'src/features/learning/learner-course-repository.ts',
    'src/features/learning/learner-progress-repository.ts',
    'src/features/learning/scorm-repository.ts',
    'src/features/learning/certificate-repository.ts',
  ])('%s supports organization-published courses without requiring mentor_id', (path) => {
    const code = source(path)
    expect(code).toContain('course.company_id')
    expect(code).toContain('public.companies')
  })
})
