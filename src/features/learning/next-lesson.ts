import type { LearnerCourse, LearnerLesson } from './learner-course-repository'

/**
 * Which lesson a learner should open next. One rule, shared by the course player (the lesson it opens when no
 * `?lesson=` is given) and the "Continue" card on My Learning, so both always point at the same lesson.
 * Availability (scheduled, drip, prerequisite and sequential locks) is already worked out by
 * learnerCourseRepository.getLearnerCourse; this only reads it.
 */

type LessonState = Pick<LearnerLesson, 'id' | 'isAvailable' | 'completed'>
type LessonRelease = LessonState & Pick<LearnerLesson, 'lockReason' | 'releaseAt' | 'dripDelayDays'>

const DAY_MS = 24 * 60 * 60 * 1000

/** The course's published lessons in curriculum order (sections, then lessons). */
export function curriculumLessons(course: Pick<LearnerCourse, 'sections'>): LearnerLesson[] {
  return course.sections.flatMap((section) => section.lessons)
}

/** The first lesson the learner can open and has not completed, or null when there is none. */
export function nextLessonToLearn<T extends LessonState>(lessons: readonly T[]): T | null {
  return lessons.find((lesson) => lesson.isAvailable && !lesson.completed) ?? null
}

/**
 * The lesson the player opens by default: the next lesson to learn; when everything open is done, the first open
 * lesson (to review); when nothing is open, the first lesson (shown locked).
 */
export function defaultPlayerLesson<T extends LessonState>(lessons: readonly T[]): T | null {
  return nextLessonToLearn(lessons)
    ?? lessons.find((lesson) => lesson.isAvailable)
    ?? lessons[0]
    ?? null
}

/** When a locked lesson opens by itself (scheduled or drip), or null when it waits on something else. */
export function lessonOpensAt(lesson: Pick<LearnerLesson, 'lockReason' | 'releaseAt' | 'dripDelayDays'>, enrolledAt: Date): Date | null {
  if (lesson.lockReason === 'scheduled') {
    if (!lesson.releaseAt) return null
    const releaseAt = new Date(lesson.releaseAt)
    return Number.isNaN(releaseAt.getTime()) ? null : releaseAt
  }
  if (lesson.lockReason === 'drip') {
    return new Date(enrolledAt.getTime() + Math.max(0, lesson.dripDelayDays ?? 0) * DAY_MS)
  }
  return null
}

export type ResumePoint<T extends LessonState = LearnerLesson> =
  /** `position` is 1-based among the course's published lessons; `total` is their count. */
  | { kind: 'next'; lesson: T; position: number; total: number }
  /** Every published lesson is complete. */
  | { kind: 'all_done'; total: number }
  /** Lessons are left but none is open yet; `opensAt` is when the next one opens, when it opens on a date. */
  | { kind: 'waiting'; opensAt: Date | null; total: number }
  /** No published lessons. */
  | { kind: 'empty' }

/** Where the learner picks the course up again, using the same rule as the player. */
export function resumePoint<T extends LessonRelease>(lessons: readonly T[], enrolledAt: Date): ResumePoint<T> {
  const total = lessons.length
  if (!total) return { kind: 'empty' }

  const next = nextLessonToLearn(lessons)
  if (next) return { kind: 'next', lesson: next, position: lessons.indexOf(next) + 1, total }

  const firstLeft = lessons.find((lesson) => !lesson.completed)
  if (!firstLeft) return { kind: 'all_done', total }
  return { kind: 'waiting', opensAt: lessonOpensAt(firstLeft, enrolledAt), total }
}
