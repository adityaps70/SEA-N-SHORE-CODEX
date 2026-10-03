import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createLearningAdminRepository } from './admin-repository'

const administratorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const courseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mentorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const migrationSql = readFileSync('infra/aws/database/migrations/0022_learning_course_discoverability.sql', 'utf8')

function createRepository(currentStatus: 'submitted' | 'published') {
  const seen: Array<{ text: string; values?: readonly unknown[] }> = []
  const query = async (text: string, values?: readonly unknown[]) => {
    seen.push({ text, values })
    if (text.includes('from public.user_roles')) return [{ allowed: true }]
    if (text.includes('from public.learning_courses') && text.includes('for update')) {
      return [{ id: courseId, mentor_id: mentorId, status: currentStatus }]
    }
    if (text.includes('update public.learning_courses')) return [{ id: courseId }]
    return []
  }
  return {
    seen,
    repository: createLearningAdminRepository({ query, transaction: async (work) => work(query) }),
  }
}

describe('learning course catalog discoverability', () => {
  it('binds administrator approval to the status transition that makes a course discoverable', async () => {
    const { repository, seen } = createRepository('submitted')

    await expect(repository.reviewCourse(administratorId, courseId, 'approved', null)).resolves.toEqual({
      courseId,
      status: 'published',
    })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.values?.[1]).toBe('published')
    expect(migrationSql).toMatch(/before update of status on public\.learning_courses/i)
    expect(migrationSql).toMatch(/new\.status = 'published'[\s\S]*new\.is_discoverable := true/i)
  })

  it('binds archiving to the status transition that removes a course from discovery', async () => {
    const { repository, seen } = createRepository('published')

    await expect(repository.reviewCourse(administratorId, courseId, 'archived', null)).resolves.toEqual({
      courseId,
      status: 'archived',
    })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.values?.[1]).toBe('archived')
    expect(migrationSql).toMatch(/new\.status is distinct from 'published'[\s\S]*new\.is_discoverable := false/i)
  })
})
