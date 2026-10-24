import { describe, expect, it } from 'vitest'
import { JOB_DESCRIPTION_MIN_LENGTH, jobDraftTitle, thingsToFix, validateJobDraft, validateJobForm, validateJobPublish, type JobFormValues } from './job-form-rules'

const today = '2026-10-17'
const longDescription = 'Command a product tanker on a nine-month contract, with full responsibility for safe navigation, cargo operations and crew.'

function values(overrides: Partial<JobFormValues> = {}): JobFormValues {
  return {
    title: 'Master',
    description: longDescription,
    domain: 'sea',
    location: 'Mumbai',
    regions: ['Worldwide'],
    salaryMin: 9000,
    salaryMax: 11000,
    experienceMinYears: 12,
    experienceMaxYears: null,
    joiningFrom: '2026-11-01',
    acceptedRoleKeys: ['master'],
    ...overrides,
  }
}

const fields = (issues: Array<{ field: string }>) => issues.map((issue) => issue.field)

describe('validateJobForm (Round H, H7)', () => {
  it('accepts a complete, consistent job', () => {
    expect(longDescription.length).toBeGreaterThanOrEqual(JOB_DESCRIPTION_MIN_LENGTH)
    expect(validateJobForm(values(), { today })).toEqual({ errors: [], warnings: [] })
  })

  it('needs a description of at least 120 characters that is not the title', () => {
    const short = validateJobForm(values({ description: 'Full command.' }), { today })
    expect(short.errors).toEqual([{ field: 'description', message: 'Describe the role in at least 120 characters (13 so far).' }])
    expect(fields(validateJobForm(values({ description: '' }), { today }).errors)).toEqual(['description'])
    const title = 'Master for a product tanker trading worldwide on a nine month contract, joining in Singapore with full handover from the outgoing Master'
    const repeated = validateJobForm(values({ title, description: ` ${title.toUpperCase()} ` }), { today })
    expect(repeated.errors).toEqual([{ field: 'description', message: 'The description repeats the job title. Describe the duties, contract and vessel.' }])
  })

  it('needs salary min ≤ max and experience min ≤ max', () => {
    expect(validateJobForm(values({ salaryMin: 12000, salaryMax: 9000 }), { today }).errors).toEqual([{ field: 'salaryMax', message: 'Maximum salary must be at least the minimum salary.' }])
    expect(validateJobForm(values({ salaryMin: 9000, salaryMax: 9000 }), { today }).errors).toEqual([])
    expect(validateJobForm(values({ salaryMin: 9000, salaryMax: null }), { today }).errors).toEqual([])
    expect(fields(validateJobForm(values({ experienceMinYears: 12, experienceMaxYears: 10 }), { today }).errors)).toEqual(['experienceMaxYears'])
  })

  it('refuses a joining date in the past, but allows today and an unchanged saved date', () => {
    expect(validateJobForm(values({ joiningFrom: '2026-10-16' }), { today }).errors).toEqual([{ field: 'joiningFrom', message: 'The joining date can’t be in the past. Pick today or a later date.' }])
    expect(validateJobForm(values({ joiningFrom: today }), { today }).errors).toEqual([])
    expect(validateJobForm(values({ joiningFrom: null }), { today }).errors).toEqual([])
    expect(validateJobForm(values({ joiningFrom: '2026-09-01' }), { today, savedJoiningFrom: '2026-09-01' }).errors).toEqual([])
    expect(fields(validateJobForm(values({ joiningFrom: '2026-09-02' }), { today, savedJoiningFrom: '2026-09-01' }).errors)).toEqual(['joiningFrom'])
  })

  it('refuses a location that conflicts with the regions', () => {
    // A shore office ("Andheri East") cannot be worldwide.
    const office = validateJobForm(values({ domain: 'shore', acceptedRoleKeys: [], location: 'Andheri East', regions: ['Worldwide'] }), { today })
    expect(office.errors).toEqual([{ field: 'regions', message: 'A shore job based in Andheri East can’t have Worldwide as its region. Remove Worldwide from the regions, or set the location to Remote if the work can be done from anywhere.' }])
    // "Worldwide" as the location, but only some regions.
    const worldwide = validateJobForm(values({ location: 'Worldwide', regions: ['Middle East', 'Far East'] }), { today })
    expect(worldwide.errors).toEqual([{ field: 'location', message: 'The location says “Worldwide” but the sailing regions are only Middle East, Far East. Set the location to the joining port or city, or add Worldwide to the regions.' }])
    expect(fields(validateJobForm(values({ domain: 'shore', acceptedRoleKeys: [], location: 'Onboard', regions: [] }), { today }).errors)).toEqual(['location'])
    expect(fields(validateJobForm(values({ location: 'Remote', regions: [] }), { today }).errors)).toEqual(['location'])
  })

  it('accepts locations that agree with the regions', () => {
    // A sea job joins at a port and sails worldwide.
    expect(validateJobForm(values({ location: 'Mumbai', regions: ['Worldwide'] }), { today }).errors).toEqual([])
    expect(validateJobForm(values({ location: 'Worldwide', regions: ['Worldwide', 'Middle East'] }), { today }).errors).toEqual([])
    expect(validateJobForm(values({ domain: 'shore', acceptedRoleKeys: [], location: 'Remote', regions: ['Worldwide'] }), { today }).errors).toEqual([])
    expect(validateJobForm(values({ domain: 'shore', acceptedRoleKeys: [], location: 'Andheri East', regions: [] }), { today }).errors).toEqual([])
    expect(validateJobForm(values({ location: null, regions: [] }), { today }).errors).toEqual([])
  })

  it('warns, without blocking, when the experience is low for the rank', () => {
    const master = validateJobForm(values({ experienceMinYears: 0 }), { today })
    expect(master.errors).toEqual([])
    expect(master.warnings).toEqual([{ field: 'experienceMinYears', message: 'Master Mariner usually needs 10+ years of sea service; check the experience years.' }])
    expect(validateJobForm(values({ acceptedRoleKeys: ['chief_engineer'], experienceMinYears: 4 }), { today }).warnings[0]?.message).toBe('Chief Engineer usually needs 10+ years of sea service; check the experience years.')
    // An older job's rank text counts too.
    expect(fields(validateJobForm(values({ acceptedRoleKeys: [], rank: 'Captain', experienceMinYears: 2 }), { today }).warnings)).toEqual(['experienceMinYears'])
  })

  it('does not warn when the experience is typical, not given, or the job also takes junior ranks', () => {
    expect(validateJobForm(values({ experienceMinYears: 10 }), { today }).warnings).toEqual([])
    expect(validateJobForm(values({ experienceMinYears: null }), { today }).warnings).toEqual([])
    expect(validateJobForm(values({ acceptedRoleKeys: ['master', 'second_officer'], experienceMinYears: 0 }), { today }).warnings).toEqual([])
    expect(validateJobForm(values({ acceptedRoleKeys: ['master', 'chief_officer'], experienceMinYears: 5 }), { today }).warnings).toEqual([])
    expect(validateJobForm(values({ acceptedRoleKeys: ['master', 'chief_officer'], experienceMinYears: 3 }), { today }).warnings[0]?.message).toBe('Chief Officer usually needs 5+ years of sea service; check the experience years.')
  })
})

describe('drafts and publishing (hotfix P2)', () => {
  it('saves a draft with only a title, or a rank when the title is empty', () => {
    expect(validateJobDraft({ title: 'Master' })).toEqual([])
    expect(validateJobDraft({ title: '', acceptedRoleKeys: ['master', 'chief_officer'] })).toEqual([])
    expect(jobDraftTitle({ title: '  ', acceptedRoleKeys: ['master', 'chief_officer'] })).toBe('Master / Captain, Chief Officer')
    expect(jobDraftTitle({ title: '', rank: 'Bosun' })).toBe('Bosun')
    expect(validateJobDraft({ title: ' ' })).toEqual([{ field: 'title', message: 'Add a job title (or pick a rank) to save a draft.' }])
  })

  it('a draft is never held back by the publish rules', () => {
    const broken = values({ description: 'Short.', salaryMin: 9000, salaryMax: 100, joiningFrom: '2020-01-01', domain: 'shore', location: 'Onboard' })
    expect(validateJobDraft(broken)).toEqual([])
    expect(validateJobForm(broken, { today }).errors.length).toBeGreaterThan(2)
  })

  it('Publish needs the title, department, ranks, “Other” text and summary too, in the order of the form', () => {
    const result = validateJobPublish(values({ title: '', summary: '', departmentKey: null, acceptedRoleKeys: [], description: 'Short.' }), { today })
    expect(fields(result.errors)).toEqual(['title', 'departmentKey', 'summary', 'description'])
    const ranks = validateJobPublish(values({ summary: 'Tanker', departmentKey: 'deck_officers', acceptedRoleKeys: [] }), { today })
    expect(fields(ranks.errors)).toEqual(['acceptedRoleKeys'])
    const other = validateJobPublish(values({ summary: 'Tanker', departmentKey: 'catering', acceptedRoleKeys: ['other_catering'], roleOtherText: '' }), { today })
    expect(fields(other.errors)).toEqual(['roleOtherText'])
  })

  it('an older job with rank text may publish without a department, and the apply-by check can be left to the lifecycle', () => {
    const legacy = values({ summary: 'Tanker', departmentKey: null, acceptedRoleKeys: [], rank: 'Master', applyUntil: '2026-01-01' })
    expect(fields(validateJobPublish(legacy, { today }).errors)).toEqual(['applyUntil'])
    expect(validateJobPublish(legacy, { today, checkApplyUntil: false }).errors).toEqual([])
    expect(validateJobPublish(values({ summary: 'Tanker', departmentKey: null, acceptedRoleKeys: [] }), { today, requireDepartment: false }).errors).toEqual([])
  })

  it('counts things to fix in words', () => {
    expect(thingsToFix(1)).toBe('1 thing to fix')
    expect(thingsToFix(2)).toBe('2 things to fix')
  })
})
