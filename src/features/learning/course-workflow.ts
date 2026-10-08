export const COURSE_STATUSES = [
  'draft',
  'submitted',
  'changes_requested',
  'approved',
  'published',
  'archived',
] as const

export type CourseStatus = (typeof COURSE_STATUSES)[number]
export type CourseWorkflowActor = 'mentor' | 'administrator'

export type CourseStatusTransition = {
  actor: CourseWorkflowActor
  current: CourseStatus
  next: CourseStatus
}

const COURSE_TRANSITIONS: Record<
  CourseWorkflowActor,
  Partial<Record<CourseStatus, readonly CourseStatus[]>>
> = {
  mentor: {
    draft: ['submitted'],
    changes_requested: ['submitted'],
    // Withdrawing from review returns the course to an editable draft. The
    // submitted content is kept exactly as it was; nothing is discarded.
    submitted: ['draft'],
  },
  administrator: {
    submitted: ['changes_requested', 'approved'],
    approved: ['published'],
    published: ['archived'],
    // Unarchive: the course returns to the catalogue. Enrolled learners never lost access.
    archived: ['published'],
  },
}

export function canTransitionCourseStatus(input: CourseStatusTransition): boolean {
  return COURSE_TRANSITIONS[input.actor][input.current]?.includes(input.next) ?? false
}

/**
 * One editing rule, applied by every course mutation (details, curriculum,
 * materials, quizzes, media, SCORM):
 * - draft and changes_requested: editable.
 * - submitted (in review): read-only. The trainer can withdraw it from review,
 *   which returns it to draft, edit, and resubmit.
 * - approved, published and archived: read-only. The live copy stays exactly as
 *   the reviewer approved it. A published course is changed through a draft
 *   revision (a private copy that is editable as a draft); on approval the
 *   revision is applied to the live course.
 */
export function canMentorEditCourse(status: CourseStatus): boolean {
  return status === 'draft' || status === 'changes_requested'
}

export type CourseEditLock = 'in_review' | 'published' | 'archived'

export function courseEditLock(status: CourseStatus): CourseEditLock | null {
  if (canMentorEditCourse(status)) return null
  if (status === 'submitted') return 'in_review'
  if (status === 'archived') return 'archived'
  return 'published'
}

/** Plain-language explanation of why a save was refused, for any course mutation. */
export function courseEditLockedCopy(status: CourseStatus | null, subject = 'Your changes') {
  const lock = status ? courseEditLock(status) : null
  if (lock === 'in_review') {
    return `${subject} were not saved because this course is in review. Withdraw it from review on the edit page to make changes, then resubmit.`
  }
  if (lock === 'archived') {
    return `${subject} were not saved because this course is archived and can no longer be edited.`
  }
  if (lock === 'published') {
    return `${subject} were not saved because this course is live. Choose “Edit course” on its Learning Studio page to make your changes in a draft copy, then submit them for review.`
  }
  return `${subject} were not saved because this course is in review or published. Reload the page to see its current status.`
}
