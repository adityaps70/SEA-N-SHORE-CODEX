import { describe, expect, it, vi } from 'vitest'
import { createAssignmentGradingRepository } from './assignment-grading-repository'

describe('assignment grading repository', () => {
  it('records a failing mentor grade without completing learner progress', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        attempt_id: 'attempt-1', status: 'submitted', enrollment_id: 'enrollment-1', lesson_id: 'lesson-1',
        learner_id: 'learner-1', course_id: 'course-1', course_slug: 'course-slug', max_points: 100, passing_percentage: 70,
      }])
      .mockResolvedValueOnce([{ graded_at: new Date('2026-09-15T13:00:00.000Z') }])
    const repository = createAssignmentGradingRepository({ transaction: async (work) => work(query) })

    const result = await repository.grade('mentor-1', 'attempt-1', { scorePoints: 60, feedback: 'Strengthen the inspection evidence.' })

    expect(result).toMatchObject({ percentage: 60, passed: false, progressPercent: null, enrollmentCompleted: false })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('completes the material only when the mentor grade meets the pass threshold', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        attempt_id: 'attempt-1', status: 'submitted', enrollment_id: 'enrollment-1', lesson_id: 'lesson-1',
        learner_id: 'learner-1', course_id: 'course-1', course_slug: 'course-slug', max_points: 100, passing_percentage: 70,
      }])
      .mockResolvedValueOnce([{ graded_at: new Date('2026-09-15T13:00:00.000Z') }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total_lessons: 2, completed_lessons: 1 }])
    const repository = createAssignmentGradingRepository({ transaction: async (work) => work(query) })

    const result = await repository.grade('mentor-1', 'attempt-1', { scorePoints: 85, feedback: 'Passed.' })

    expect(result).toMatchObject({ percentage: 85, passed: true, progressPercent: 50, enrollmentCompleted: false })
    expect(String(query.mock.calls[2]?.[0])).toContain('completed = true')
  })

  it('does not expose an attempt that is outside the authenticated mentor ownership scope', async () => {
    const query = vi.fn().mockResolvedValueOnce([])
    const repository = createAssignmentGradingRepository({ transaction: async (work) => work(query) })

    await expect(repository.grade('mentor-1', 'attempt-elsewhere', { scorePoints: 80, feedback: null }))
      .rejects.toThrow('assignment_attempt_not_found')
  })
})
