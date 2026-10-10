import { describe, expect, it } from 'vitest'
import { consentWording, crewTagsSchema, parseInviteEmails } from './crew-rules'
import { trainingCsv, type AssignedSeat } from './dashboard-repository'

describe('company training crew rules (D3)', () => {
  it('splits pasted addresses, lower-cases them, drops duplicates and keeps the rest apart', () => {
    expect(parseInviteEmails('Crew.One@Example.com, crew.two@example.com\n<crew.one@example.com>; not-an-email  third@example.org')).toEqual({
      valid: ['crew.one@example.com', 'crew.two@example.com', 'third@example.org'],
      invalid: ['not-an-email'],
    })
    expect(parseInviteEmails('   ')).toEqual({ valid: [], invalid: [] })
  })

  it('tidies vessel and rank tags and treats blanks as none', () => {
    expect(crewTagsSchema.parse({ vessel: '  MT   Ocean Star ', rank: '' })).toEqual({ vessel: 'MT Ocean Star', rank: null })
    expect(crewTagsSchema.safeParse({ vessel: 'x'.repeat(81) }).success).toBe(false)
  })

  it('names what is shared and what never is', () => {
    const wording = consentWording('Fixture Shipping')
    expect(wording.shares.join(' ')).toContain('progress')
    expect(wording.shares.join(' ')).toContain('certificate')
    expect(wording.neverShares.join(' ')).toContain('other courses')
    expect(wording.summary).toContain('nothing else')
  })
})

describe('company training CSV (D3)', () => {
  const base: AssignedSeat = {
    seatId: 's1', courseId: 'c1', courseTitle: 'Tanker, Basics', courseSlug: null, assignedAt: '2026-09-02T05:00:00.000Z',
    learner: { profileId: 'p1', name: '=HYPERLINK("x")', slug: null, vessel: 'MT "Star"', rank: 'Master' },
    sharing: 'active',
    progress: { percent: 100, state: 'completed', completedAt: '2026-09-20T05:00:00.000Z', accessExpiresAt: null, certificate: { number: 'SNS-2026-ABCDEF123456', issuedAt: '2026-09-20T05:00:00.000Z', expiresAt: null } },
    canReassign: false,
  }

  it('quotes cells, stops formulas, and leaves out progress for members who stopped sharing', () => {
    const csv = trainingCsv([base, { ...base, seatId: 's2', learner: { ...base.learner, name: 'Fixture Two' }, sharing: 'withdrawn', progress: null }])
    const [header, first, second] = csv.trim().split('\r\n')
    expect(header!.startsWith('Name,Vessel,Rank,Course')).toBe(true)
    expect(first).toBe(`"'=HYPERLINK(""x"")","MT ""Star""",Master,"Tanker, Basics",2026-09-02,Yes,100,Completed,2026-09-20,SNS-2026-ABCDEF123456,2026-09-20,,`)
    expect(second).toBe('Fixture Two,"MT ""Star""",Master,"Tanker, Basics",2026-09-02,Stopped sharing,,,,,,,')
  })
})
