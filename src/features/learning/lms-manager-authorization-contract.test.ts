import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('organization LMS manager authorization coverage', () => {
  it.each([
    'src/features/learning/mentor-curriculum-repository.ts',
    'src/features/learning/mentor-material-repository.ts',
    'src/features/learning/media-repository.ts',
    'src/features/learning/assignment-grading-repository.ts',
    'src/features/learning/mentor-analytics-repository.ts',
  ])('%s uses the central course manager authorization rule', (path) => {
    const code = source(path)
    expect(code).toContain('courseManagerAccessSql')
    expect(code).toContain("from './course-access'")
  })

  it('keeps learner SCORM launch independent from Studio manager authorization', () => {
    const code = source('src/features/learning/scorm-repository.ts')
    expect(code).toContain('learning_enrollments')
    expect(code).toContain("course.status = 'published'")
  })
})
