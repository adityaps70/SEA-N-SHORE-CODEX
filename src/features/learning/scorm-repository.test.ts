import { describe, expect, it, vi } from 'vitest'
import { createScormRepository } from './scorm-repository'

describe('SCORM repository', () => {
  it('starts a learner-scoped SCORM attempt', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        package_id: 'package-1',
        enrollment_id: 'enrollment-1',
        lesson_id: 'lesson-1',
        scorm_version: '2004',
        max_attempts: 2,
        attempts_used: 0,
      }])
      .mockResolvedValueOnce([{ id: 'attempt-1', attempt_number: 1 }])
      .mockResolvedValueOnce([])

    const repository = createScormRepository({ transaction: async (work) => work(query) })
    const result = await repository.startAttempt('learner-1', 'course-slug', 'lesson-1')
    expect(result).toMatchObject({ id: 'attempt-1', attemptNumber: 1, scormVersion: '2004' })
  })

  it('refuses to start another attempt after max attempts', async () => {
    const query = vi.fn().mockResolvedValueOnce([{
      package_id: 'package-1',
      enrollment_id: 'enrollment-1',
      lesson_id: 'lesson-1',
      scorm_version: '1.2',
      max_attempts: 1,
      attempts_used: 1,
    }])
    const repository = createScormRepository({ transaction: async (work) => work(query) })
    await expect(repository.startAttempt('learner-1', 'course-slug', 'lesson-1'))
      .rejects.toThrow('learning_attempt_limit_reached')
  })

  it('commits SCORM state and completes material on terminal completion', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        id: 'attempt-1',
        enrollment_id: 'enrollment-1',
        lesson_id: 'lesson-1',
        scorm_version: '2004',
        completion_status: 'incomplete',
        success_status: 'unknown',
        score_raw: null,
        score_scaled: null,
        location: null,
        suspend_data: null,
        session_time_seconds: 0,
        total_time_seconds: 0,
        exit_value: null,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const repository = createScormRepository({ transaction: async (work) => work(query) })
    const result = await repository.commit('learner-1', 'attempt-1', {
      'cmi.completion_status': 'completed',
      'cmi.success_status': 'passed',
      'cmi.score.scaled': '0.9',
    })
    expect(result.completed).toBe(true)
    expect(result.state.successStatus).toBe('passed')
  })
})
