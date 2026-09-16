import { describe, expect, it, vi } from 'vitest'
import { createAssignmentGradingRepository } from './assignment-grading-repository'

describe('assignment grading repository', () => {
  it('loads a mentor-owned assignment review with instructions and previous attempts', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        attempt_id: 'attempt-2', attempt_number: 2, status: 'submitted', submitted_at: new Date('2026-09-16T08:30:00.000Z'),
        response_text: 'Updated inspection evidence.', attachment_path: null, score_points: null, percentage: null,
        passed: null, feedback: null, graded_at: null, max_points: 100, passing_percentage: 70,
        course_title: 'SIRE 2.0 Readiness', course_slug: 'sire-2-readiness', lesson_title: 'Inspection assignment',
        learner_name: 'Test Learner', assignment_instructions: 'Submit a structured inspection readiness response.',
        enrollment_id: 'enrollment-1', lesson_id: 'lesson-1', learner_id: 'learner-1',
      }])
      .mockResolvedValueOnce([{
        attempt_id: 'attempt-1', attempt_number: 1, status: 'graded', submitted_at: new Date('2026-09-15T08:30:00.000Z'),
        response_text: 'Initial inspection evidence.', attachment_path: null, score_points: 60, percentage: 60,
        passed: false, feedback: 'Add stronger evidence.', graded_at: new Date('2026-09-15T10:00:00.000Z'),
      }])
    const repository = createAssignmentGradingRepository({ query })

    const result = await repository.getForMentor('mentor-1', 'attempt-2')

    expect(result).toMatchObject({
      id: 'attempt-2',
      assignmentInstructions: 'Submit a structured inspection readiness response.',
      learnerName: 'Test Learner',
      previousAttempts: [{ id: 'attempt-1', attemptNumber: 1, passed: false, feedback: 'Add stronger evidence.' }],
    })
    expect(query).toHaveBeenCalledTimes(2)
    expect(String(query.mock.calls[0]?.[0])).toContain('mentor.user_id = $1')
    expect(query.mock.calls[0]?.[1]).toEqual(['mentor-1', 'attempt-2'])
  })

  it('does not expose review detail outside the authenticated mentor ownership scope', async () => {
    const query = vi.fn().mockResolvedValueOnce([])
    const repository = createAssignmentGradingRepository({ query })

    await expect(repository.getForMentor('mentor-1', 'attempt-elsewhere')).resolves.toBeNull()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('records an explicit needs-revision grade without completing learner progress', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        attempt_id: 'attempt-1', status: 'submitted', enrollment_id: 'enrollment-1', lesson_id: 'lesson-1',
        learner_id: 'learner-1', course_id: 'course-1', course_slug: 'course-slug', max_points: 100, passing_percentage: 70,
      }])
      .mockResolvedValueOnce([{ graded_at: new Date('2026-09-15T13:00:00.000Z') }])
    const repository = createAssignmentGradingRepository({ transaction: async (work) => work(query) })

    const result = await repository.grade('mentor-1', 'attempt-1', {
      scorePoints: 60,
      feedback: 'Strengthen the inspection evidence.',
      decision: 'needs_revision',
    })

    expect(result).toMatchObject({ percentage: 60, passed: false, progressPercent: null, enrollmentCompleted: false })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('completes the material only when an explicit pass meets the configured pass threshold', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        attempt_id: 'attempt-1', status: 'submitted', enrollment_id: 'enrollment-1', lesson_id: 'lesson-1',
        learner_id: 'learner-1', course_id: 'course-1', course_slug: 'course-slug', max_points: 100, passing_percentage: 70,
      }])
      .mockResolvedValueOnce([{ graded_at: new Date('2026-09-15T13:00:00.000Z') }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total_lessons: 2, completed_lessons: 1 }])
    const repository = createAssignmentGradingRepository({ transaction: async (work) => work(query) })

    const result = await repository.grade('mentor-1', 'attempt-1', {
      scorePoints: 85,
      feedback: 'Passed.',
      decision: 'pass',
    })

    expect(result).toMatchObject({ percentage: 85, passed: true, progressPercent: 50, enrollmentCompleted: false })
    expect(String(query.mock.calls[2]?.[0])).toContain('completed = true')
  })

  it('rejects Pass when the score is below the configured pass threshold', async () => {
    const query = vi.fn().mockResolvedValueOnce([{
      attempt_id: 'attempt-1', status: 'submitted', enrollment_id: 'enrollment-1', lesson_id: 'lesson-1',
      learner_id: 'learner-1', course_id: 'course-1', course_slug: 'course-slug', max_points: 100, passing_percentage: 70,
    }])
    const repository = createAssignmentGradingRepository({ transaction: async (work) => work(query) })

    await expect(repository.grade('mentor-1', 'attempt-1', {
      scorePoints: 69,
      feedback: 'Pass requested.',
      decision: 'pass',
    })).rejects.toThrow('assignment_pass_score_below_threshold')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('rejects Needs revision when the score already meets the configured pass threshold', async () => {
    const query = vi.fn().mockResolvedValueOnce([{
      attempt_id: 'attempt-1', status: 'submitted', enrollment_id: 'enrollment-1', lesson_id: 'lesson-1',
      learner_id: 'learner-1', course_id: 'course-1', course_slug: 'course-slug', max_points: 100, passing_percentage: 70,
    }])
    const repository = createAssignmentGradingRepository({ transaction: async (work) => work(query) })

    await expect(repository.grade('mentor-1', 'attempt-1', {
      scorePoints: 70,
      feedback: 'Revision requested.',
      decision: 'needs_revision',
    })).rejects.toThrow('assignment_revision_score_meets_threshold')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('does not expose an attempt that is outside the authenticated mentor ownership scope', async () => {
    const query = vi.fn().mockResolvedValueOnce([])
    const repository = createAssignmentGradingRepository({ transaction: async (work) => work(query) })

    await expect(repository.grade('mentor-1', 'attempt-elsewhere', { scorePoints: 80, feedback: null, decision: 'pass' }))
      .rejects.toThrow('assignment_attempt_not_found')
  })
})
