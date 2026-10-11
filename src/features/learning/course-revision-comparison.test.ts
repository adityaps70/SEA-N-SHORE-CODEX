import { describe, expect, it } from 'vitest'
import type { CourseSnapshotMaterial } from './course-review-snapshot'
import { compareMaterialText, createCourseRevisionComparisonRepository } from './course-revision-comparison'

function material(id: string, overrides: Partial<CourseSnapshotMaterial> = {}): CourseSnapshotMaterial {
  return {
    id,
    title: `Material ${id}`,
    materialType: 'article',
    summary: null,
    articleBody: 'INSPECTION DAY\nCheck the lines.',
    assetPath: null,
    externalUrl: null,
    isPublished: true,
    releaseMode: 'immediate',
    completionRule: 'view',
    assignmentInstructions: null,
    quiz: null,
    articleFormat: 'plain',
    ...overrides,
  }
}

describe('compareMaterialText (round E)', () => {
  it('lists changed, new and removed materials by their live ids, with before and after text', () => {
    const live = [{ title: 'Module 1', materials: [material('a'), material('b'), material('gone')] }]
    const revision = [{
      title: 'Module 1',
      materials: [
        material('a', { articleBody: '<h2>Inspection Day</h2><p>Check the lines.</p>', articleFormat: 'html' }),
        material('b'),
        material('new', { title: 'A new note' }),
      ],
    }]
    const result = compareMaterialText(live, revision)
    expect(result.map((item) => [item.id, item.status, item.fields])).toEqual([
      ['a', 'changed', ['article']],
      ['new', 'added', ['title', 'article']],
      ['gone', 'removed', []],
    ])
    expect(result[0]!.before.articleFormat).toBe('plain')
    expect(result[0]!.after.articleFormat).toBe('html')
  })
})

describe('courseRevisionComparisonRepository.load (round E)', () => {
  it('opens only a draft revision the actor manages (or any, for a platform administrator)', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createCourseRevisionComparisonRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return []
      },
    })
    await expect(repository.load('user-1', 'rev-1', { platformAdmin: false })).resolves.toBeNull()
    expect(seen[0]!.text).toContain('course.revision_of_course_id is not null')
    expect(seen[0]!.text).toContain('$3::boolean or')
    expect(seen[0]!.values).toEqual(['rev-1', 'user-1', false])
  })
})
