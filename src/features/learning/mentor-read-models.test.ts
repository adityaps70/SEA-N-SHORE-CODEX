import { describe, expect, it } from 'vitest'
import { createLearningRepository } from './repository'
import { createLearningAdminRepository } from './admin-repository'

const applicantId = '11111111-1111-4111-8111-111111111111'
const administratorId = '22222222-2222-4222-8222-222222222222'

describe('mentor application learner read model', () => {
  it('returns none when the learner has never applied to teach', async () => {
    const repository = createLearningRepository({ query: async () => [] })

    await expect(repository.getMentorApplicationState(applicantId)).resolves.toEqual({ kind: 'none' })
  })

  it('returns review state with mentor activation after approval', async () => {
    const repository = createLearningRepository({
      query: async () => [{
        application_id: 'application-1',
        status: 'approved',
        submitted_at: '2026-09-14T12:00:00.000Z',
        updated_at: '2026-09-14T13:00:00.000Z',
        admin_review_note: 'Verified Master Mariner credentials.',
        mentor_id: 'mentor-1',
        mentor_status: 'active',
      }],
    })

    await expect(repository.getMentorApplicationState(applicantId)).resolves.toEqual({
      kind: 'mentor',
      applicationId: 'application-1',
      status: 'approved',
      submittedAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T13:00:00.000Z',
      adminReviewNote: 'Verified Master Mariner credentials.',
      mentorId: 'mentor-1',
      mentorStatus: 'active',
    })
  })
})

describe('mentor application administrator read model', () => {
  it('fails closed before listing the mentor review queue for a non-administrator', async () => {
    const repository = createLearningAdminRepository({ query: async () => [] })

    await expect(repository.listMentorApplications(administratorId, 'pending')).rejects.toThrow('admin_forbidden')
  })

  it('lists pending mentor applications oldest first with maritime verification context', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createLearningAdminRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.user_roles')) return [{ allowed: true }]
        return [{
          application_id: 'application-1',
          user_id: applicantId,
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
          status: 'pending',
          submitted_at: '2026-09-14T12:00:00.000Z',
          updated_at: '2026-09-14T12:00:00.000Z',
          admin_review_note: null,
        }]
      },
    })

    await expect(repository.listMentorApplications(administratorId, 'pending')).resolves.toEqual([{
      applicationId: 'application-1',
      userId: applicantId,
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
      status: 'pending',
      submittedAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T12:00:00.000Z',
      adminReviewNote: null,
    }])

    const listQuery = seen.find((entry) => entry.text.includes('from public.learning_mentor_applications'))
    expect(listQuery?.text).toContain('where application.status = $1')
    expect(listQuery?.text).toContain('order by application.submitted_at asc, application.id asc')
    expect(listQuery?.values).toEqual(['pending'])
  })
})
