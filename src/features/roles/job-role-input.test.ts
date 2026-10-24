import { describe, expect, it } from 'vitest'
import { draftJobRoles, validateJobRoles } from './job-role-input'

describe('job department, accepted ranks and minimum match', () => {
  it('requires a department and at least one accepted rank for new jobs', () => {
    expect(validateJobRoles({}, { domain: 'sea', requireDepartment: true })).toEqual({ ok: false, error: 'Choose the department for this job.' })
    expect(validateJobRoles({ departmentKey: 'deck_officers' }, { domain: 'sea', requireDepartment: true }))
      .toEqual({ ok: false, error: 'Choose at least one accepted rank / role.' })
  })

  it('accepts several ranks from one department and keeps the label text in step', () => {
    const result = validateJobRoles(
      { departmentKey: 'deck_officers', acceptedRoleKeys: ['master', 'chief_officer', 'master'] },
      { domain: 'shore', requireDepartment: true },
    )
    expect(result).toEqual({
      ok: true,
      data: {
        departmentKey: 'deck_officers',
        acceptedRoleKeys: ['master', 'chief_officer'],
        roleOtherText: null,
        minMatchToApply: 70,
        domain: 'sea',
        departmentLabel: 'Deck officers',
        rankLabel: 'Master / Captain, Chief Officer',
      },
    })
  })

  it('defaults the minimum match to 70, allows 0 and rejects anything outside 0..100', () => {
    const base = { departmentKey: 'technical_fleet', acceptedRoleKeys: ['technical_superintendent'] }
    expect(validateJobRoles(base, { domain: 'shore', requireDepartment: true })).toMatchObject({ ok: true, data: { minMatchToApply: 70, domain: 'shore' } })
    expect(validateJobRoles({ ...base, minMatchToApply: 0 }, { domain: 'shore', requireDepartment: true })).toMatchObject({ ok: true, data: { minMatchToApply: 0 } })
    expect(validateJobRoles({ ...base, minMatchToApply: 101 }, { domain: 'shore', requireDepartment: true }).ok).toBe(false)
    expect(validateJobRoles({ ...base, minMatchToApply: 55.5 }, { domain: 'shore', requireDepartment: true }).ok).toBe(false)
  })

  it('rejects unknown keys and ranks from another department', () => {
    expect(validateJobRoles({ departmentKey: 'deck_officers', acceptedRoleKeys: ['grand_admiral'] }, { domain: 'sea', requireDepartment: true }).ok).toBe(false)
    expect(validateJobRoles({ departmentKey: 'deck_officers', acceptedRoleKeys: ['cook'] }, { domain: 'sea', requireDepartment: true }).ok).toBe(false)
    expect(validateJobRoles({ departmentKey: 'space_fleet', acceptedRoleKeys: ['master'] }, { domain: 'sea', requireDepartment: true }).ok).toBe(false)
  })

  it('needs the typed text for "Other"', () => {
    expect(validateJobRoles({ departmentKey: 'catering', acceptedRoleKeys: ['other_catering'] }, { domain: 'sea', requireDepartment: true }).ok).toBe(false)
    expect(validateJobRoles({ departmentKey: 'catering', acceptedRoleKeys: ['other_catering'], roleOtherText: 'Baker' }, { domain: 'sea', requireDepartment: true }))
      .toMatchObject({ ok: true, data: { roleOtherText: 'Baker', rankLabel: 'Baker' } })
  })

  it('lets an older job be edited without a department', () => {
    expect(validateJobRoles({}, { domain: 'shore', requireDepartment: false }))
      .toMatchObject({ ok: true, data: { departmentKey: null, acceptedRoleKeys: [], domain: 'shore', rankLabel: null } })
  })
})

describe('draftJobRoles (hotfix P2)', () => {
  it('keeps a department picked before its ranks, and drops only what is not valid yet', () => {
    expect(draftJobRoles({ departmentKey: 'deck_officers', acceptedRoleKeys: [] }, { domain: 'shore' })).toMatchObject({
      departmentKey: 'deck_officers', acceptedRoleKeys: [], domain: 'sea', departmentLabel: expect.any(String), rankLabel: null,
    })
    expect(draftJobRoles({ departmentKey: 'catering', acceptedRoleKeys: ['other_catering', 'master'], roleOtherText: '' }, { domain: 'sea' }))
      .toMatchObject({ departmentKey: 'catering', acceptedRoleKeys: ['other_catering'], roleOtherText: null })
    expect(draftJobRoles({ departmentKey: 'not_a_department', acceptedRoleKeys: ['master'], minMatchToApply: 140 }, { domain: 'sea' }))
      .toMatchObject({ departmentKey: null, acceptedRoleKeys: [], minMatchToApply: 70 })
  })

  it('returns the strict result when the choice is already complete', () => {
    const strict = validateJobRoles({ departmentKey: 'deck_officers', acceptedRoleKeys: ['master'] }, { domain: 'sea', requireDepartment: false })
    expect(strict.ok && draftJobRoles({ departmentKey: 'deck_officers', acceptedRoleKeys: ['master'] }, { domain: 'sea' })).toEqual(strict.ok && strict.data)
  })
})
