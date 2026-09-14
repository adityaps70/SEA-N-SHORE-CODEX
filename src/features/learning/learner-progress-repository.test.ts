import { describe, expect, it } from 'vitest'
import { createLearnerProgressRepository } from './learner-progress-repository'

const learnerId = '11111111-1111-4111-8111-111111111111'
const enrollmentId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const lessonId = '66666666-6666-4666-8666-666666666666'
const slug = 'sire-2-readiness-for-tanker-officers'

type ResumeRepository = ReturnType<typeof createLearnerProgressRepository> & {
  savePlaybackPosition: (
    learnerId: string,
    slug: string,
    lessonId: string,
    positionSeconds: number,
  ) => Promise<{
    enrollmentId: string
    lessonId: string
    lastPositionSeconds: number
  }>
}

describe('learner progress repository', () => {
  it('idempotently completes a visible lesson and completes the enrollment when all lessons are done', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createLearnerProgressRepository({
      transaction: async (work) => work(async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })

        if (text.includes('for update of enrollment')) {
          return [{ enrollment_id: enrollmentId, enrollment_status: 'active', course_id: courseId, lesson_id: lessonId }]
        }
        if (text.includes('insert into public.learning_progress')) {
          return [{ completed_at: new Date('2026-09-15T09:00:00.000Z') }]
        }
        if (text.includes('count(lesson.id)')) {
          return [{ total_lessons: '2', completed_lessons: '2' }]
        }
        if (text.includes('update public.learning_enrollments')) return [{ id: enrollmentId }]
        return []
      }),
    })

    await expect(repository.completeLesson(learnerId, slug, lessonId)).resolves.toEqual({
      enrollmentId,
      lessonId,
      completedAt: '2026-09-15T09:00:00.000Z',
      totalLessons: 2,
      completedLessons: 2,
      progressPercent: 100,
      enrollmentCompleted: true,
    })

    expect(seen[0]?.values).toEqual([learnerId, slug, lessonId])
    expect(seen[0]?.text).toContain("course.status = 'published'")
    expect(seen[0]?.text).toContain("mentor.status = 'active'")
    expect(seen[0]?.text).toContain("application.status = 'approved'")
    expect(seen[0]?.text).toContain("enrollment.status in ('active', 'completed')")
    expect(seen[0]?.text).toContain('lesson.id = $3')
    expect(seen[0]?.text).toContain('for update of enrollment')

    expect(seen[1]?.values).toEqual([enrollmentId, lessonId])
    expect(seen[1]?.text).toContain('insert into public.learning_progress')
    expect(seen[1]?.text).toContain('on conflict (enrollment_id, lesson_id) do update')
    expect(seen[1]?.text).toContain('completed = true')
    expect(seen[1]?.text).toContain('coalesce(public.learning_progress.completed_at, excluded.completed_at)')

    expect(seen[2]?.values).toEqual([enrollmentId, courseId])
    expect(seen[2]?.text).toContain('count(lesson.id)')
    expect(seen[2]?.text).toContain('progress.completed = true')

    expect(seen[3]?.values).toEqual([enrollmentId])
    expect(seen[3]?.text).toContain("status = 'completed'")
    expect(seen[3]?.text).toContain('completed_at = coalesce(completed_at, now())')
  })

  it('fails closed before writing progress when the lesson is not accessible to the learner', async () => {
    const seen: string[] = []
    const repository = createLearnerProgressRepository({
      transaction: async (work) => work(async (text: string) => {
        seen.push(text)
        return []
      }),
    })

    await expect(repository.completeLesson(learnerId, slug, lessonId)).rejects.toThrow('lesson_not_accessible')
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toContain('insert into public.learning_progress')
  })

  it('persists resume position for an accessible media lesson without changing completion state', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createLearnerProgressRepository({
      transaction: async (work) => work(async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })

        if (text.includes('for update of enrollment')) {
          return [{ enrollment_id: enrollmentId, enrollment_status: 'active', course_id: courseId, lesson_id: lessonId }]
        }
        if (text.includes('insert into public.learning_progress')) {
          return [{ last_position_seconds: 125 }]
        }
        return []
      }),
    }) as ResumeRepository

    await expect(repository.savePlaybackPosition(learnerId, slug, lessonId, 125)).resolves.toEqual({
      enrollmentId,
      lessonId,
      lastPositionSeconds: 125,
    })

    expect(seen).toHaveLength(2)
    expect(seen[0]?.values).toEqual([learnerId, slug, lessonId])
    expect(seen[0]?.text).toContain("course.status = 'published'")
    expect(seen[0]?.text).toContain("mentor.status = 'active'")
    expect(seen[0]?.text).toContain("application.status = 'approved'")
    expect(seen[0]?.text).toContain("enrollment.status in ('active', 'completed')")
    expect(seen[0]?.text).toContain("lesson.lesson_type in ('video', 'audio')")
    expect(seen[0]?.text).toContain('for update of enrollment')

    expect(seen[1]?.values).toEqual([enrollmentId, lessonId, 125])
    expect(seen[1]?.text).toContain('insert into public.learning_progress')
    expect(seen[1]?.text).toContain('last_position_seconds')
    expect(seen[1]?.text).toContain('on conflict (enrollment_id, lesson_id) do update')
    expect(seen[1]?.text).not.toContain('completed = true')
    expect(seen[1]?.text).not.toContain('completed_at =')
    expect(seen.some(({ text }) => text.includes('count(lesson.id)'))).toBe(false)
    expect(seen.some(({ text }) => text.includes('update public.learning_enrollments'))).toBe(false)
  })

  it('fails closed before saving a resume position when the media lesson is not accessible', async () => {
    const seen: string[] = []
    const repository = createLearnerProgressRepository({
      transaction: async (work) => work(async (text: string) => {
        seen.push(text)
        return []
      }),
    }) as ResumeRepository

    await expect(repository.savePlaybackPosition(learnerId, slug, lessonId, 125)).rejects.toThrow('lesson_not_accessible')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain("lesson.lesson_type in ('video', 'audio')")
    expect(seen[0]).not.toContain('insert into public.learning_progress')
  })
})
