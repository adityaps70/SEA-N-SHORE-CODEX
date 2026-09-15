import { describe, expect, it, vi } from 'vitest'
import { createScormRepository } from './scorm-repository'

const learnerId = '11111111-1111-4111-8111-111111111111'
const courseId = '22222222-2222-4222-8222-222222222222'
const enrollmentId = '33333333-3333-4333-8333-333333333333'
const lessonId = '44444444-4444-4444-8444-444444444444'
const attemptId = '55555555-5555-4555-8555-555555555555'

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: attemptId,
    enrollment_id: enrollmentId,
    course_id: courseId,
    lesson_id: lessonId,
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
    ...overrides,
  }
}

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

  it('completes the enrollment and issues an eligible certificate when terminal SCORM finishes the final published material', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.learning_scorm_attempts attempt') && text.includes('for update of attempt')) {
        return [attemptRow()]
      }
      if (text.includes('update public.learning_scorm_attempts')) return []
      if (text.includes('insert into public.learning_progress')) return []
      if (text.includes('count(lesson.id)')) return [{ total_lessons: '2', completed_lessons: '2' }]
      if (text.includes('update public.learning_enrollments')) return [{ id: enrollmentId }]
      if (text.includes('from public.learning_enrollments enrollment') && text.includes('learner.full_name')) {
        return [{
          enrollment_id: enrollmentId,
          course_id: courseId,
          learner_id: learnerId,
          learner_name: 'Aarav Mehta',
          course_title: 'SIRE 2.0 Readiness',
          mentor_name: 'Capt. Maya Singh',
          completed_at: new Date('2026-09-15T09:00:00.000Z'),
        }]
      }
      if (text.includes('insert into public.learning_certificates')) {
        return [{
          id: '66666666-6666-4666-8666-666666666666',
          enrollment_id: enrollmentId,
          course_id: courseId,
          learner_id: learnerId,
          certificate_number: 'SNS-2026-A1B2C3D4E5F6',
          verification_code: '77777777-7777-4777-8777-777777777777',
          learner_name: 'Aarav Mehta',
          course_title: 'SIRE 2.0 Readiness',
          mentor_name: 'Capt. Maya Singh',
          completed_at: new Date('2026-09-15T09:00:00.000Z'),
          issued_at: new Date('2026-09-15T09:00:01.000Z'),
        }]
      }
      return []
    })

    const repository = createScormRepository({ transaction: async (work) => work(query) })
    const result = await repository.commit(learnerId, attemptId, {
      'cmi.completion_status': 'completed',
      'cmi.success_status': 'passed',
      'cmi.score.scaled': '0.9',
    })

    expect(result.completed).toBe(true)
    expect(result.state.successStatus).toBe('passed')
    expect(seen.some(({ text, values }) => text.includes('count(lesson.id)') && values?.[0] === enrollmentId && values?.[1] === courseId)).toBe(true)
    expect(seen.some(({ text, values }) => text.includes('update public.learning_enrollments') && values?.[0] === enrollmentId)).toBe(true)
    expect(seen.some(({ text }) => text.includes('insert into public.learning_certificates'))).toBe(true)
  })

  it('does not finalize the enrollment or certificate for a non-terminal SCORM commit', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.learning_scorm_attempts attempt') && text.includes('for update of attempt')) {
        return [attemptRow()]
      }
      return []
    })

    const repository = createScormRepository({ transaction: async (work) => work(query) })
    const result = await repository.commit(learnerId, attemptId, {
      'cmi.completion_status': 'incomplete',
      'cmi.location': 'module-2',
    })

    expect(result.completed).toBe(false)
    expect(seen.some(({ text }) => text.includes('count(lesson.id)'))).toBe(false)
    expect(seen.some(({ text }) => text.includes('update public.learning_enrollments'))).toBe(false)
    expect(seen.some(({ text }) => text.includes('learning_certificates'))).toBe(false)
  })
})
