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
  },
  administrator: {
    submitted: ['changes_requested', 'approved'],
    approved: ['published'],
    published: ['archived'],
  },
}

export function canTransitionCourseStatus(input: CourseStatusTransition): boolean {
  return COURSE_TRANSITIONS[input.actor][input.current]?.includes(input.next) ?? false
}

export function canMentorEditCourse(status: CourseStatus): boolean {
  return status === 'draft' || status === 'changes_requested'
}
