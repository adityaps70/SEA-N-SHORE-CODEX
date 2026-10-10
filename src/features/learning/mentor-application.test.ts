import { isRawValidationMessage } from '@/lib/validation/plain-messages'
import { describe, expect, it } from 'vitest'
import {
  MENTOR_APPLICATION_STATUSES,
  canApplicantEditMentorApplication,
  canTransitionMentorApplicationStatus,
  COURSE_TOPICS_REQUIRED_MESSAGE,
  mentorApplicationSchema,
} from './mentor-application'

describe('learning mentor application', () => {
  it('normalizes maritime mentor application data before persistence', () => {
    const parsed = mentorApplicationSchema.parse({
      name: ' Capt. Maya Nair ',
      currentLastRank: ' Chief Officer ',
      yearsExperience: '12.5',
      vesselTypes: ['Oil Tanker', ' oil tanker ', 'LNG'],
      specialization: ' SIRE 2.0 / Tanker Safety ',
      certifications: ['ISO 9001 Lead Auditor', ' iso 9001 lead auditor ', 'Train the Trainer'],
      linkedInUrl: ' https://www.linkedin.com/in/maya-nair/ ',
      shortBio: ' Maritime professional focused on tanker safety, practical shipboard competence and mentoring the next generation of seafarers. ',
      profilePhotoPath: ' profiles/11111111-1111-4111-8111-111111111111/avatar.jpg ',
      proposedCourseTopics: ['SIRE 2.0 Readiness', ' sire 2.0 readiness ', 'Bridge Resource Management'],
    })

    expect(parsed).toEqual({
      name: 'Capt. Maya Nair',
      currentLastRank: 'Chief Officer',
      yearsExperience: 12.5,
      vesselTypes: ['Oil Tanker', 'LNG'],
      specialization: 'SIRE 2.0 / Tanker Safety',
      certifications: ['ISO 9001 Lead Auditor', 'Train the Trainer'],
      linkedInUrl: 'https://www.linkedin.com/in/maya-nair/',
      shortBio: 'Maritime professional focused on tanker safety, practical shipboard competence and mentoring the next generation of seafarers.',
      profilePhotoPath: 'profiles/11111111-1111-4111-8111-111111111111/avatar.jpg',
      proposedCourseTopics: ['SIRE 2.0 Readiness', 'Bridge Resource Management'],
    })
  })

  it('requires a real LinkedIn profile URL when one is supplied', () => {
    const result = mentorApplicationSchema.safeParse({
      name: 'Capt. Maya Nair',
      currentLastRank: 'Chief Officer',
      yearsExperience: 12,
      vesselTypes: ['Oil Tanker'],
      specialization: 'Tanker Safety',
      certifications: ['Train the Trainer'],
      linkedInUrl: 'https://example.com/maya',
      shortBio: 'Maritime professional focused on practical tanker safety, competence and mentoring seafarers.',
      profilePhotoPath: null,
      proposedCourseTopics: ['Tanker Safety'],
    })

    expect(result.success).toBe(false)
  })

  it('counts course topics after dropping blank items and trailing commas, and words every rule plainly (round C)', () => {
    const input = {
      name: 'Capt. Maya Nair',
      currentLastRank: 'Chief Officer',
      yearsExperience: 12,
      vesselTypes: ['Oil Tanker'],
      specialization: 'Tanker Safety',
      certifications: ['Train the Trainer'],
      linkedInUrl: null,
      shortBio: 'Maritime professional focused on practical tanker safety, competence and mentoring seafarers.',
      profilePhotoPath: null,
    }
    for (const empty of ['', ' ', ',', ' , ,, ', []]) {
      const result = mentorApplicationSchema.safeParse({ ...input, proposedCourseTopics: empty })
      expect(result.success).toBe(false)
      expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
        ['proposedCourseTopics', COURSE_TOPICS_REQUIRED_MESSAGE],
      ])
    }
    expect(mentorApplicationSchema.parse({ ...input, proposedCourseTopics: 'SIRE 2.0, , sire 2.0, Bridge,' }).proposedCourseTopics)
      .toEqual(['SIRE 2.0', 'Bridge'])

    // Every message is written for members, never zod's own wording; an unparseable URL fails instead of throwing.
    const everythingWrong = mentorApplicationSchema.safeParse({
      name: '', currentLastRank: '', yearsExperience: Number.NaN, vesselTypes: ',', specialization: '', certifications: '',
      linkedInUrl: 'not a url', shortBio: 'short', profilePhotoPath: null, proposedCourseTopics: '',
    })
    expect(everythingWrong.success).toBe(false)
    for (const issue of everythingWrong.error!.issues) {
      expect(isRawValidationMessage(issue.message), issue.message).toBe(false)
    }
    expect(everythingWrong.error!.issues.map((issue) => issue.path[0])).toEqual([
      'name', 'currentLastRank', 'yearsExperience', 'vesselTypes', 'specialization', 'certifications', 'linkedInUrl', 'shortBio', 'proposedCourseTopics',
    ])
  })

  it('defines an explicit admin-reviewed application lifecycle', () => {
    expect(MENTOR_APPLICATION_STATUSES).toEqual([
      'pending',
      'changes_requested',
      'approved',
      'rejected',
    ])

    expect(canTransitionMentorApplicationStatus({ actor: 'administrator', current: 'pending', next: 'changes_requested' })).toBe(true)
    expect(canTransitionMentorApplicationStatus({ actor: 'administrator', current: 'pending', next: 'approved' })).toBe(true)
    expect(canTransitionMentorApplicationStatus({ actor: 'administrator', current: 'pending', next: 'rejected' })).toBe(true)
    expect(canTransitionMentorApplicationStatus({ actor: 'applicant', current: 'changes_requested', next: 'pending' })).toBe(true)
    expect(canTransitionMentorApplicationStatus({ actor: 'applicant', current: 'rejected', next: 'pending' })).toBe(true)
    expect(canTransitionMentorApplicationStatus({ actor: 'applicant', current: 'pending', next: 'approved' })).toBe(false)
    expect(canTransitionMentorApplicationStatus({ actor: 'administrator', current: 'changes_requested', next: 'approved' })).toBe(false)
  })

  it('only permits applicant edits after changes are requested or rejection', () => {
    expect(canApplicantEditMentorApplication('pending')).toBe(false)
    expect(canApplicantEditMentorApplication('changes_requested')).toBe(true)
    expect(canApplicantEditMentorApplication('approved')).toBe(false)
    expect(canApplicantEditMentorApplication('rejected')).toBe(true)
  })
})
