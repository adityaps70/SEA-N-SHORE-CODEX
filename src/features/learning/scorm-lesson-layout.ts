import type { LearnerLesson } from './learner-course-repository'

/**
 * S2: a lesson the course player shows as a full-height SCORM package (compact header, frame filling the
 * window, the lesson bar in the page flow under it). Locked lessons and packages that are not ready keep the
 * regular lesson layout, like every other lesson type.
 */
export function isFullHeightScormLesson(lesson: LearnerLesson | null | undefined): boolean {
  return Boolean(
    lesson
    && lesson.lessonType === 'scorm'
    && lesson.isAvailable
    && lesson.scorm?.status === 'ready'
    && lesson.scorm.version
    && lesson.scorm.launchPath,
  )
}

/** "4 min" from the trainer's duration, or null when none is set. */
export function lessonDurationLabel(lesson: Pick<LearnerLesson, 'durationSeconds'>) {
  return lesson.durationSeconds ? `${Math.max(1, Math.round(lesson.durationSeconds / 60))} min` : null
}
