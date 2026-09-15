import { describe, expect, it } from 'vitest'
import { createLearningAdminRepository } from './admin-repository'

const administratorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const courseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mentorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('course approval marketplace regression', () => {
  it('makes an administrator-approved submitted course published immediately', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses') && text.includes('for update')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'submitted' }]
      }
      if (text.includes('update public.learning_courses')) return [{ id: courseId }]
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewCourse(administratorId, courseId, 'approved', null)).resolves.toEqual({
      courseId,
      status: 'published',
    })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.values).toEqual([courseId, 'published', administratorId, null])
    expect(update?.text).toContain('approved_at = now()')
    expect(update?.text).toContain('published_at = now()')
  })
})
