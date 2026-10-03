import { describe, expect, it } from 'vitest'
import type { MentorApplicationInput } from './mentor-application'
import { createLearningRepository } from './repository'
import { createLearningAdminRepository } from './admin-repository'

const applicantId = '11111111-1111-4111-8111-111111111111'
const administratorId = '22222222-2222-4222-8222-222222222222'

function mentorInput(overrides: Partial<MentorApplicationInput> = {}): MentorApplicationInput {
  return {
    name: 'Capt. Maya Singh',
    currentLastRank: 'Master Mariner',
    yearsExperience: 18,
    vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
    specialization: 'SIRE 2.0, tanker operations and bridge leadership',
    certifications: ['Master Unlimited', 'ISO 9001 Lead Auditor'],
    linkedInUrl: 'https://www.linkedin.com/in/maya-singh-mariner',
    shortBio: 'Master Mariner with eighteen years of sea and shore experience focused on tanker safety, leadership and practical competency development.',
    profilePhotoPath: 'learning/mentor-profiles/11111111-1111-4111-8111-111111111111/avatar.jpg',
    proposedCourseTopics: ['SIRE 2.0 readiness', 'Bridge leadership'],
    ...overrides,
  }
}

describe('learning mentor applicant repository', () => {
  it('submits one normalized mentor application for the authenticated profile', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createLearningRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('insert into public.learning_mentor_applications')) return [{ id: 'application-1' }]
        return []
      },
    })

    await expect(repository.submitMentorApplication(applicantId, mentorInput())).resolves.toEqual({ applicationId: 'application-1' })

    const insert = seen.find((entry) => entry.text.includes('insert into public.learning_mentor_applications'))
    expect(insert?.values).toContain(applicantId)
    expect(insert?.values).toContain('Capt. Maya Singh')
    expect(insert?.values).toContain('Master Mariner')
    expect(insert?.values).toContain('pending')
    expect(insert?.values).toContainEqual(['Oil Tanker', 'Chemical Tanker'])
    expect(insert?.values).toContainEqual(['SIRE 2.0 readiness', 'Bridge leadership'])
  })

  it('loads editable mentor application details only for the submitting user', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createLearningRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          application_id: 'application-1',
          applicant_name: 'Capt. Maya Singh',
          current_last_rank: 'Master Mariner',
          years_experience: '18.0',
          vessel_types: ['Oil Tanker', 'Chemical Tanker'],
          specialization: 'SIRE 2.0, tanker operations and bridge leadership',
          certifications: ['Master Unlimited', 'ISO 9001 Lead Auditor'],
          linkedin_url: 'https://www.linkedin.com/in/maya-singh-mariner',
          short_bio: 'Master Mariner with eighteen years of sea and shore experience focused on tanker safety, leadership and practical competency development.',
          profile_photo_path: 'learning/mentor-profiles/11111111-1111-4111-8111-111111111111/avatar.jpg',
          proposed_course_topics: ['SIRE 2.0 readiness', 'Bridge leadership'],
        }]
      },
    })

    await expect(repository.getMentorApplication(applicantId, 'application-1')).resolves.toEqual(mentorInput())
    expect(seen[0]?.text).toContain('user_id = $1')
    expect(seen[0]?.text).toContain('id = $2')
    expect(seen[0]?.values).toEqual([applicantId, 'application-1'])
  })

  it('resubmits only a changes-requested or rejected application and clears prior review state', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update')) {
        return [{ id: 'application-1', user_id: applicantId, status: 'changes_requested' }]
      }
      if (text.includes('update public.learning_mentor_applications')) return [{ id: 'application-1' }]
      return []
    }
    const repository = createLearningRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.resubmitMentorApplication(applicantId, 'application-1', mentorInput({ specialization: 'Updated SIRE 2.0 and bridge leadership specialization' }))).resolves.toBe(true)

    const update = seen.find((entry) => entry.text.includes('update public.learning_mentor_applications'))
    expect(update?.text).toContain("status = 'pending'")
    expect(update?.text).toContain('reviewed_by = null')
    expect(update?.text).toContain('reviewed_at = null')
    expect(update?.text).toContain('admin_review_note = null')
  })

  it('rejects applicant resubmission while review is still pending', async () => {
    const query = async (text: string) => {
      if (text.includes('for update')) return [{ id: 'application-1', user_id: applicantId, status: 'pending' }]
      return []
    }
    const repository = createLearningRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.resubmitMentorApplication(applicantId, 'application-1', mentorInput())).rejects.toThrow('mentor_application_resubmit_forbidden')
  })
})

describe('learning mentor admin repository', () => {
  it('fails closed when a non-administrator attempts to review a mentor application', async () => {
    const repository = createLearningAdminRepository({
      query: async (text) => text.includes('from public.user_roles') ? [] : [],
      transaction: async (work) => work(async (text) => text.includes('from public.user_roles') ? [] : []),
    })

    await expect(repository.reviewMentorApplication(administratorId, 'application-1', 'approved', null)).rejects.toThrow('admin_forbidden')
  })

  it('approves a pending application, materializes the mentor and records an audit event atomically', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    let transactionCount = 0
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_mentor_applications') && text.includes('for update')) {
        return [{ id: 'application-1', user_id: applicantId, status: 'pending' }]
      }
      if (text.includes('insert into public.learning_mentors')) return [{ id: 'mentor-1' }]
      if (text.includes('update public.learning_mentor_applications')) return [{ id: 'application-1' }]
      return []
    }
    const repository = createLearningAdminRepository({
      query,
      transaction: async (work) => {
        transactionCount += 1
        return work(query)
      },
    })

    await expect(repository.reviewMentorApplication(administratorId, 'application-1', 'approved', 'Verified maritime credentials and instructional background.')).resolves.toEqual({
      applicationId: 'application-1',
      status: 'approved',
      mentorId: 'mentor-1',
    })

    expect(transactionCount).toBe(1)
    expect(seen.some((entry) => entry.text.includes('for update'))).toBe(true)
    const mentorInsert = seen.find((entry) => entry.text.includes('insert into public.learning_mentors'))
    expect(mentorInsert?.values).toContain(applicantId)
    expect(mentorInsert?.values).toContain('application-1')
    expect(mentorInsert?.values).toContain(administratorId)
    const auditInsert = seen.find((entry) => entry.text.includes('insert into public.audit_events'))
    expect(auditInsert?.values).toContain('learning.mentor_application.approved')
    expect(auditInsert?.values).toContain(administratorId)
  })

  it('requests changes without creating a mentor record', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_mentor_applications') && text.includes('for update')) {
        return [{ id: 'application-1', user_id: applicantId, status: 'pending' }]
      }
      if (text.includes('update public.learning_mentor_applications')) return [{ id: 'application-1' }]
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewMentorApplication(administratorId, 'application-1', 'changes_requested', 'Please clarify LNG/LPG teaching experience.')).resolves.toEqual({
      applicationId: 'application-1',
      status: 'changes_requested',
      mentorId: null,
    })

    expect(seen.some((entry) => entry.text.includes('insert into public.learning_mentors'))).toBe(false)
    expect(seen.find((entry) => entry.text.includes('insert into public.audit_events'))?.values).toContain('learning.mentor_application.changes_requested')
  })

  it('rejects review of an application that is no longer pending', async () => {
    const query = async (text: string) => {
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('for update')) return [{ id: 'application-1', user_id: applicantId, status: 'approved' }]
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewMentorApplication(administratorId, 'application-1', 'rejected', 'Duplicate application.')).rejects.toThrow('mentor_application_transition_forbidden')
  })
})
