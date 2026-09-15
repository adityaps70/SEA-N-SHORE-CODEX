import { describe, expect, it, vi } from 'vitest'
import { createLearnerAssignmentRepository } from './learner-assignment-repository'

describe('learner assignment repository', () => {
  it('creates a numbered submission that waits for mentor grading instead of completing the material', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        assignment_id: 'assignment-1',
        enrollment_id: 'enrollment-1',
        lesson_id: 'lesson-1',
        max_attempts: 2,
        attempts_used: 0,
        pending_attempt_id: null,
      }])
      .mockResolvedValueOnce([{
        id: 'attempt-1',
        attempt_number: 1,
        status: 'submitted',
        submitted_at: new Date('2026-09-15T12:00:00.000Z'),
      }])
      .mockResolvedValueOnce([])

    const repository = createLearnerAssignmentRepository({
      transaction: async (work) => work(query),
    })

    const result = await repository.submit('learner-1', 'course-slug', 'lesson-1', {
      responseText: 'My inspection-readiness response',
      attachmentPath: null,
    })

    expect(result).toEqual({
      attemptId: 'attempt-1',
      attemptNumber: 1,
      status: 'submitted',
      submittedAt: '2026-09-15T12:00:00.000Z',
      completed: false,
    })
    expect(query.mock.calls.some(([sql]) => String(sql).includes('learning_assignment_attempts'))).toBe(true)
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into public.learning_progress'))).toBe(true)
    expect(query.mock.calls.some(([sql]) => String(sql).includes('completed = true'))).toBe(false)
  })

  it('rejects a new submission while the previous attempt is still awaiting mentor grading', async () => {
    const query = vi.fn().mockResolvedValueOnce([{
      assignment_id: 'assignment-1',
      enrollment_id: 'enrollment-1',
      lesson_id: 'lesson-1',
      max_attempts: 3,
      attempts_used: 1,
      pending_attempt_id: 'attempt-1',
    }])
    const repository = createLearnerAssignmentRepository({
      transaction: async (work) => work(query),
    })

    await expect(repository.submit('learner-1', 'course-slug', 'lesson-1', {
      responseText: 'A second response before grading',
      attachmentPath: null,
    })).rejects.toThrow('assignment_review_pending')

    expect(query).toHaveBeenCalledTimes(1)
  })

  it('rejects submissions when mentor-configured attempt limit is exhausted', async () => {
    const query = vi.fn().mockResolvedValueOnce([{
      assignment_id: 'assignment-1',
      enrollment_id: 'enrollment-1',
      lesson_id: 'lesson-1',
      max_attempts: 1,
      attempts_used: 1,
      pending_attempt_id: null,
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
