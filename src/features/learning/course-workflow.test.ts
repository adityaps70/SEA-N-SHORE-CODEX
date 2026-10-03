import { describe, expect, it } from 'vitest'
import {
  COURSE_STATUSES,
  canMentorEditCourse,
  canTransitionCourseStatus,
} from './course-workflow'

describe('learning course workflow', () => {
  it('defines the persisted course states used by the native LMS', () => {
    expect(COURSE_STATUSES).toEqual([
      'draft',
      'submitted',
      'changes_requested',
      'approved',
      'published',
      'archived',
    ])
  })

  it('allows mentors to submit drafts and resubmit requested changes', () => {
    expect(canTransitionCourseStatus({ actor: 'mentor', current: 'draft', next: 'submitted' })).toBe(true)
    expect(canTransitionCourseStatus({ actor: 'mentor', current: 'changes_requested', next: 'submitted' })).toBe(true)
  })

  it('never lets a mentor approve or publish a course', () => {
    expect(canTransitionCourseStatus({ actor: 'mentor', current: 'submitted', next: 'approved' })).toBe(false)
    expect(canTransitionCourseStatus({ actor: 'mentor', current: 'approved', next: 'published' })).toBe(false)
  })

  it('keeps review and publishing decisions with administrators', () => {
    expect(canTransitionCourseStatus({ actor: 'administrator', current: 'submitted', next: 'changes_requested' })).toBe(true)
    expect(canTransitionCourseStatus({ actor: 'administrator', current: 'submitted', next: 'approved' })).toBe(true)
    expect(canTransitionCourseStatus({ actor: 'administrator', current: 'approved', next: 'published' })).toBe(true)
    expect(canTransitionCourseStatus({ actor: 'administrator', current: 'published', next: 'archived' })).toBe(true)
    expect(canTransitionCourseStatus({ actor: 'administrator', current: 'draft', next: 'published' })).toBe(false)
  })

  it('only allows mentor content edits while the course is editable', () => {
    expect(canMentorEditCourse('draft')).toBe(true)
    expect(canMentorEditCourse('changes_requested')).toBe(true)
    expect(canMentorEditCourse('submitted')).toBe(false)
    expect(canMentorEditCourse('approved')).toBe(false)
    expect(canMentorEditCourse('published')).toBe(false)
    expect(canMentorEditCourse('archived')).toBe(false)
  })
})
