import { describe, expect, it, vi } from 'vitest'
import { createLearnerAssignmentRepository } from './learner-assignment-repository'

describe('learner assignment repository', () => {
  it('creates a numbered submission and reports completion', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        assignment_id: 'assignment-1',
        enrollment_id: 'enrollment-1',
        lesson_id: 'lesson-1',
        max_attempts: 2,
        attempts_used: 0,
      }])
      .mockResolvedValueOnce([{ id: 'attempt-1', attempt_number: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const repository = createLearnerAssignmentRepository({
      transaction: async (work) => work(query),
    })

    const result = await repository.submit('learner-1', 'course-slug', 'lesson-1', {
      responseText: 'My inspection-readiness response',
      attachmentPath: null,
    })

    expect(result).toMatchObject({ attemptId: 'attempt-1', attemptNumber: 1, completed: true })
    expect(query.mock.calls.some(([sql]) => String(sql).includes('learning_assignment_attempts'))).toBe(true)
  })

  it('rejects submissions when mentor-configured attempt limit is exhausted', async () => {
    const query = vi.fn().mockResolvedValueOnce([{
      assignment_id: 'assignment-1',
      enrollment_id: 'enrollment-1',
      lesson_id: 'lesson-1',
      max_attempts: 1,
      attempts_used: 1,
    }])
    const repository = createLearnerAssignmentRepository({
      transaction: async (work) => work(query),
    })

    await expect(repository.submit('learner-1', 'course-slug', 'lesson-1', {
      responseText: 'Retry',
      attachmentPath: null,
    })).rejects.toThrow('learning_attempt_limit_reached')
  })
})
