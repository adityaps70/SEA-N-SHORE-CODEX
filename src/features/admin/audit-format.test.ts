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
    expect(auditTargetHref('unknown', 'x')).toBeNull()
  })

  it('summarises decision, prior state, report count and the reason', () => {
    expect(auditDetails({ decision: 'changes_requested', previousState: 'pending', reportCount: '2', reason: 'Spam' }))
      .toEqual(['Decision: changes requested', 'Previously pending', '2 reports', 'Spam'])
    expect(auditDetails({ reportCount: 1 })).toEqual(['1 report'])
    expect(auditDetails({})).toEqual([])
  })
})
