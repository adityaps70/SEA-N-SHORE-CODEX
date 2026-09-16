import { describe, expect, it } from 'vitest'
import { createLearningAdminRepository } from './admin-repository'

const administratorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const courseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mentorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

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
  it('makes an administrator-approved course discoverable in the same publication update', async () => {
    const { repository, seen } = createRepository('submitted')

    await expect(repository.reviewCourse(administratorId, courseId, 'approved', null)).resolves.toEqual({
      courseId,
      status: 'published',
    })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.text).toContain('is_discoverable = true')
  })

  it('removes an archived published course from public discovery in the same update', async () => {
    const { repository, seen } = createRepository('published')

    await expect(repository.reviewCourse(administratorId, courseId, 'archived', null)).resolves.toEqual({
      courseId,
      status: 'archived',
    })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.text).toContain('is_discoverable = false')
  })
})
