import { describe, expect, it } from 'vitest'
import type { LearnerLesson } from './learner-course-repository'
import { curriculumLessons, defaultPlayerLesson, lessonOpensAt, nextLessonToLearn, resumePoint } from './next-lesson'

type Lesson = Pick<LearnerLesson, 'id' | 'isAvailable' | 'completed' | 'lockReason' | 'releaseAt' | 'dripDelayDays'>

function lesson(id: string, overrides: Partial<Lesson> = {}): Lesson {
  return { id, isAvailable: true, completed: false, lockReason: null, releaseAt: null, dripDelayDays: null, ...overrides }
}

const locked = (reason: Lesson['lockReason'], extra: Partial<Lesson> = {}) => ({ isAvailable: false, lockReason: reason, ...extra })
const enrolledAt = new Date('2026-10-01T00:00:00.000Z')

describe('next lesson rule (shared by the player and My Learning)', () => {
  it('picks the first open lesson that is not complete, in curriculum order', () => {
    const lessons = [lesson('a', { completed: true }), lesson('b'), lesson('c')]
    expect(nextLessonToLearn(lessons)?.id).toBe('b')
    expect(defaultPlayerLesson(lessons)?.id).toBe('b')
    expect(resumePoint(lessons, enrolledAt)).toEqual({ kind: 'next', lesson: lessons[1], position: 2, total: 3 })
  })

  it('skips lessons locked by a schedule, drip or prerequisite (including sequential) lock', () => {
    const lessons = [
      lesson('done', { completed: true }),
      lesson('scheduled', locked('scheduled', { releaseAt: '2026-12-01T00:00:00.000Z' })),
      lesson('drip', locked('drip', { dripDelayDays: 14 })),
      lesson('prerequisite', locked('prerequisite')),
      lesson('open'),
    ]
    expect(nextLessonToLearn(lessons)?.id).toBe('open')
    expect(resumePoint(lessons, enrolledAt)).toMatchObject({ kind: 'next', lesson: { id: 'open' }, position: 5, total: 5 })
  })

  it('reports every lesson done, while the player falls back to the first open lesson for review', () => {
    const lessons = [lesson('a', { completed: true }), lesson('b', { completed: true })]
    expect(nextLessonToLearn(lessons)).toBeNull()
    expect(defaultPlayerLesson(lessons)?.id).toBe('a')
    expect(resumePoint(lessons, enrolledAt)).toEqual({ kind: 'all_done', total: 2 })
  })

  it('counts a completed lesson that is locked again as done', () => {
    const lessons = [lesson('a', { completed: true, ...locked('scheduled') })]
    expect(resumePoint(lessons, enrolledAt)).toEqual({ kind: 'all_done', total: 1 })
  })

  it('reports when the next lesson opens when nothing is available yet', () => {
    const scheduled = [lesson('done', { completed: true }), lesson('later', locked('scheduled', { releaseAt: '2026-12-01T09:00:00.000Z' }))]
    expect(nextLessonToLearn(scheduled)).toBeNull()
    expect(defaultPlayerLesson(scheduled)?.id).toBe('done')
    expect(resumePoint(scheduled, enrolledAt)).toEqual({ kind: 'waiting', opensAt: new Date('2026-12-01T09:00:00.000Z'), total: 2 })

    const drip = [lesson('drip', locked('drip', { dripDelayDays: 7 })), lesson('after', locked('prerequisite'))]
    expect(defaultPlayerLesson(drip)?.id).toBe('drip')
    expect(resumePoint(drip, enrolledAt)).toEqual({ kind: 'waiting', opensAt: new Date('2026-10-08T00:00:00.000Z'), total: 2 })
  })

  it('has no opening date for a lesson waiting on a prerequisite or an unscheduled release', () => {
    expect(resumePoint([lesson('a', locked('prerequisite'))], enrolledAt)).toEqual({ kind: 'waiting', opensAt: null, total: 1 })
    expect(lessonOpensAt(lesson('b', locked('scheduled')), enrolledAt)).toBeNull()
    expect(lessonOpensAt(lesson('c', locked('scheduled', { releaseAt: 'not a date' })), enrolledAt)).toBeNull()
    expect(lessonOpensAt(lesson('d', locked('drip', { dripDelayDays: null })), enrolledAt)).toEqual(enrolledAt)
  })

  it('handles a course with no published lessons', () => {
    expect(nextLessonToLearn([])).toBeNull()
    expect(defaultPlayerLesson([])).toBeNull()
    expect(resumePoint([], enrolledAt)).toEqual({ kind: 'empty' })
  })

  it('reads lessons in section order, then lesson order', () => {
    const first = lesson('s1-l1') as LearnerLesson
    const second = lesson('s1-l2') as LearnerLesson
    const third = lesson('s2-l1') as LearnerLesson
    expect(curriculumLessons({
      sections: [
        { id: 's1', title: 'One', position: 0, lessons: [first, second] },
        { id: 's2', title: 'Two', position: 1, lessons: [third] },
      ],
    }).map((item) => item.id)).toEqual(['s1-l1', 's1-l2', 's2-l1'])
  })
})
