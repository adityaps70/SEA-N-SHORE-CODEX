import { describe, expect, it } from 'vitest'
import { auditActionLabel, auditDetails, auditSummary, auditTargetHref, auditTargetLabel, auditVerb } from './audit-format'

describe('audit formatting', () => {
  it('turns dotted action keys into sentence-case labels', () => {
    expect(auditActionLabel('account.permanently_deleted')).toBe('Account · Permanently deleted')
    expect(auditActionLabel('organization.approved')).toBe('Organization · Approved')
  })

  it('extracts the verb and builds a one-line summary without repeating the target', () => {
    expect(auditVerb('account.permanently_deleted')).toBe('Permanently deleted')
    expect(auditVerb('restored')).toBe('Restored')
    expect(auditSummary('user_account', 'account.suspended')).toBe('Account suspended')
    expect(auditSummary('organization_application', 'organization.approved')).toBe('Organization approved')
  })

  it('names and links every target type, including user accounts', () => {
    expect(auditTargetLabel('user_account')).toBe('Account')
    expect(auditTargetLabel('organization_application')).toBe('Organization')
    expect(auditTargetHref('user_account', 'abc')).toBe('/admin/users/abc')
    expect(auditTargetHref('post', 'p1')).toBe('/posts/p1')
    expect(auditTargetLabel('company_access_request')).toBe('Access request')
    // Round 9B: community groups are moderation and admin targets too.
    expect(auditTargetLabel('group')).toBe('Group')
    expect(auditTargetHref('group', 'g1')).toBe('/admin/communities?group=g1')
    expect(auditTargetHref('unknown', 'x')).toBeNull()
  })

  it('summarises decision, prior state, report count and the reason', () => {
    expect(auditDetails({ decision: 'changes_requested', previousState: 'pending', reportCount: '2', reason: 'Spam' }))
      .toEqual(['Decision: changes requested', 'Previously pending', '2 reports', 'Spam'])
    expect(auditDetails({ reportCount: 1 })).toEqual(['1 report'])
    expect(auditDetails({})).toEqual([])
  })
})

describe('learning audit actions (round H, H7)', () => {
  // Every learning.course.* and learning.mentor_application.* action the code writes (admin-repository.ts,
  // migration 0086), plus the two-part learning actions recorded against a course.
  const actions: Array<[targetType: string, action: string, summary: string]> = [
    ['learning_course', 'learning.course.approved', 'Course approved'],
    ['learning_course', 'learning.course.changes_requested', 'Course changes requested'],
    ['learning_course', 'learning.course.published', 'Course published'],
    ['learning_course', 'learning.course.archived', 'Course archived'],
    ['learning_course', 'learning.course.revision_approved', 'Course revision approved'],
    ['learning_course', 'learning.course.publisher_transferred', 'Course publisher transferred'],
    ['learning_mentor_application', 'learning.mentor_application.approved', 'Trainer application approved'],
    ['learning_mentor_application', 'learning.mentor_application.changes_requested', 'Trainer application changes requested'],
    ['learning_mentor_application', 'learning.mentor_application.rejected', 'Trainer application rejected'],
    ['learning_course', 'learning.course_community_linked', 'Course community linked'],
    ['learning_course', 'learning.course_community_unlinked', 'Course community unlinked'],
    ['learning_course', 'learning.roster_enrolled', 'Course roster enrolled'],
    ['learning_course', 'learning.session_created', 'Course session created'],
    ['course_review', 'moderation.course_review_approved', 'Course review approved'],
  ]

  it.each(actions)('%s %s reads "%s" without a repeated word', (targetType, action, summary) => {
    expect(auditSummary(targetType, action)).toBe(summary)
    expect(auditSummary(targetType, action)).not.toMatch(/\b(\w+) \1\b/i)
  })

  it('names learning targets and keeps the verb free of the object', () => {
    expect(auditTargetLabel('learning_course')).toBe('Course')
    expect(auditTargetLabel('learning_mentor_application')).toBe('Trainer application')
    expect(auditVerb('learning.course.revision_approved')).toBe('Revision approved')
    expect(auditVerb('learning.mentor_application.approved')).toBe('Approved')
    expect(auditActionLabel('learning.course.revision_approved')).toBe('Learning · Course · Revision approved')
  })
})
