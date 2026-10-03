import { describe, expect, it } from 'vitest'
import { createEnrollmentRepository } from './enrollment-repository'

const learnerId = '11111111-1111-4111-8111-111111111111'
const enrollmentId = '33333333-3333-4333-8333-333333333333'
const courseId = '22222222-2222-4222-8222-222222222222'

describe('learner enrollment certificate evidence', () => {
  it('returns certificate id and verification code with completed learning when issued', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createEnrollmentRepository({
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        return [{
          enrollment_id: enrollmentId,
          enrollment_status: 'completed',
          enrolled_at: '2026-09-14T12:00:00.000Z',
          completed_at: '2026-09-15T09:00:00.000Z',
          course_id: courseId,
          slug: 'sire-2-readiness-for-tanker-officers',
          title: 'SIRE 2.0 Readiness for Tanker Officers',
          subtitle: null,
          category: 'SIRE 2.0',
          level: 'advanced',
          language: 'English',
          thumbnail_path: null,
          course_format: 'recorded',
          certificate_enabled: true,
          mentor_name: 'Capt. Maya Singh',
          certificate_id: '44444444-4444-4444-8444-444444444444',
          certificate_verification_code: '55555555-5555-4555-8555-555555555555',
          total_lessons: '8',
          completed_lessons: '8',
        }]
      },
    })

    await expect(repository.listLearnerEnrollments(learnerId)).resolves.toEqual([expect.objectContaining({
      enrollmentId,
      enrollmentStatus: 'completed',
      certificateEnabled: true,
      certificateId: '44444444-4444-4444-8444-444444444444',
      certificateVerificationCode: '55555555-5555-4555-8555-555555555555',
      progressPercent: 100,
    })])

    expect(seen[0]?.text).toContain('left join public.learning_certificates certificate')
    expect(seen[0]?.text).toContain('certificate.id as certificate_id')
    expect(seen[0]?.text).toContain('certificate.verification_code as certificate_verification_code')
  })

  it('returns null certificate evidence while no certificate has been issued', async () => {
    const repository = createEnrollmentRepository({
      query: async () => [{
        enrollment_id: enrollmentId,
        enrollment_status: 'active',
        enrolled_at: '2026-09-14T12:00:00.000Z',
        completed_at: null,
        course_id: courseId,
        slug: 'sire-2-readiness-for-tanker-officers',
        title: 'SIRE 2.0 Readiness for Tanker Officers',
        subtitle: null,
        category: 'SIRE 2.0',
        level: 'advanced',
        language: 'English',
        thumbnail_path: null,
        course_format: 'recorded',
        certificate_enabled: true,
        mentor_name: 'Capt. Maya Singh',
        certificate_id: null,
        certificate_verification_code: null,
        total_lessons: '8',
        completed_lessons: '3',
      }],
    })

    const [item] = await repository.listLearnerEnrollments(learnerId)
    expect(item.certificateId).toBeNull()
    expect(item.certificateVerificationCode).toBeNull()
  })
})
