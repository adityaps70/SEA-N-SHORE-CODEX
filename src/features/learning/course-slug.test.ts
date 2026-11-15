import { describe, expect, it } from 'vitest'
import { COURSE_SLUG_MAX, firstFreeSlug, slugifyCourseTitle } from './course-slug'
import { createCourseRepository } from './course-repository'

describe('course slug from the title (owner, 15 Nov)', () => {
  it('is lowercase with single hyphens and no special characters', () => {
    expect(slugifyCourseTitle('SIRE 2.0 Readiness: Tanker Officers!')).toBe('sire-2-0-readiness-tanker-officers')
    expect(slugifyCourseTitle('  Crane & Rigging — Basics  ')).toBe('crane-and-rigging-basics')
    expect(slugifyCourseTitle('Ünïcödé Navigation ⚓ 101')).toBe('unicode-navigation-101')
    expect(slugifyCourseTitle('!!!')).toBe('')
    const long = slugifyCourseTitle('word '.repeat(60))
    expect(long.length).toBeLessThanOrEqual(COURSE_SLUG_MAX)
    expect(long).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('adds -2, -3 when taken', () => {
    expect(firstFreeSlug('ballast-water', new Set())).toBe('ballast-water')
    expect(firstFreeSlug('ballast-water', new Set(['ballast-water']))).toBe('ballast-water-2')
    expect(firstFreeSlug('ballast-water', new Set(['ballast-water', 'ballast-water-2', 'ballast-water-4']))).toBe('ballast-water-3')
  })

  it('the repository looks at every course with that slug or a numbered one', async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createCourseRepository({
      query: async (text, values) => {
        calls.push({ text, values })
        return [{ slug: 'ballast-water' }, { slug: 'ballast-water-2' }, { slug: 'ballast-water-basics' }] as never
      },
    })
    expect(await repository.availableSlug('ballast-water')).toBe('ballast-water-3')
    expect(calls[0]!.text).toMatch(/from public\.learning_courses where slug = \$1 or slug like \$2/)
    expect(calls[0]!.values).toEqual(['ballast-water', 'ballast-water-%'])
  })
})
