import { describe, expect, it } from 'vitest'
import { createCertificateRepository, issueCertificateForCompletedEnrollmentWithQuery } from './certificate-repository'

const learnerId = '11111111-1111-4111-8111-111111111111'
const enrollmentId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const certificateId = '44444444-4444-4444-8444-444444444444'
const verificationCode = '55555555-5555-4555-8555-555555555555'

function certificateRow() {
  return {
    id: certificateId,
    enrollment_id: enrollmentId,
    course_id: courseId,
    learner_id: learnerId,
    certificate_number: 'SNS-2026-A1B2C3D4E5F6',
    verification_code: verificationCode,
    learner_name: 'Aarav Mehta',
    course_title: 'SIRE 2.0 Readiness',
    mentor_name: 'Capt. Maya Singh',
    completed_at: new Date('2026-09-15T08:00:00.000Z'),
    issued_at: new Date('2026-09-15T08:01:00.000Z'),
  }
}

describe('learning certificate repository', () => {
  it('issues one immutable certificate for an eligible completed enrollment', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.learning_enrollments enrollment') && text.includes('learner.full_name')) {
        return [{
          enrollment_id: enrollmentId,
          course_id: courseId,
          learner_id: learnerId,
          learner_name: 'Aarav Mehta',
          course_title: 'SIRE 2.0 Readiness',
          mentor_name: 'Capt. Maya Singh',
          completed_at: new Date('2026-09-15T08:00:00.000Z'),
        }]
      }
      if (text.includes('insert into public.learning_certificates')) return [certificateRow()]
      return []
    }

    await expect(issueCertificateForCompletedEnrollmentWithQuery(query, enrollmentId)).resolves.toEqual({
      certificateId,
      enrollmentId,
      courseId,
      learnerId,
      certificateNumber: 'SNS-2026-A1B2C3D4E5F6',
      verificationCode,
      learnerName: 'Aarav Mehta',
      courseTitle: 'SIRE 2.0 Readiness',
      mentorName: 'Capt. Maya Singh',
      completedAt: '2026-09-15T08:00:00.000Z',
      issuedAt: '2026-09-15T08:01:00.000Z',
    })

    const eligible = seen.find((entry) => entry.text.includes('learner.full_name'))
    expect(eligible?.values).toEqual([enrollmentId])
    expect(eligible?.text).toContain("enrollment.status = 'completed'")
    expect(eligible?.text).toContain('course.certificate_enabled = true')
    expect(eligible?.text).toContain('public.companies company')
    expect(eligible?.text).toContain('company.name')

    const insert = seen.find((entry) => entry.text.includes('insert into public.learning_certificates'))
    expect(insert?.text).toContain('on conflict (enrollment_id) do update')
    expect(insert?.text).toContain('learner_name')
    expect(insert?.text).toContain('course_title')
    expect(insert?.text).toContain('mentor_name')
  })

  it('does not issue a certificate when the completed enrollment is not eligible', async () => {
    const seen: string[] = []
    const query = async (text: string) => {
      seen.push(text)
      return []
    }

    await expect(issueCertificateForCompletedEnrollmentWithQuery(query, enrollmentId)).resolves.toBeNull()
    expect(seen.some((text) => text.includes('insert into public.learning_certificates'))).toBe(false)
  })

  it('ensures a certificate only for the authenticated learner own enrollment', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.learning_enrollments') && text.includes('learner_id = $1')) return [{ id: enrollmentId }]
      if (text.includes('from public.learning_enrollments enrollment') && text.includes('learner.full_name')) {
        return [{
          enrollment_id: enrollmentId,
          course_id: courseId,
          learner_id: learnerId,
          learner_name: 'Aarav Mehta',
          course_title: 'SIRE 2.0 Readiness',
          mentor_name: 'Capt. Maya Singh',
          completed_at: '2026-09-15T08:00:00.000Z',
        }]
      }
      if (text.includes('insert into public.learning_certificates')) return [certificateRow()]
      return []
    }
    const repository = createCertificateRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.ensureCertificateForEnrollment(learnerId, enrollmentId)).resolves.toMatchObject({ certificateId })
    const ownership = seen.find((entry) => entry.text.includes('learner_id = $1'))
    expect(ownership?.values).toEqual([learnerId, enrollmentId])
  })

  it('fails closed when a learner tries to ensure another enrollment certificate', async () => {
    const query = async () => []
    const repository = createCertificateRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.ensureCertificateForEnrollment(learnerId, enrollmentId)).rejects.toThrow('certificate_enrollment_not_accessible')
  })

  it('reads an owned certificate by certificate id', async () => {
    const query = async (text: string, values?: readonly unknown[]) => {
      if (text.includes('from public.learning_certificates certificate') && text.includes('certificate.learner_id = $1')) {
        expect(values).toEqual([learnerId, certificateId])
        return [certificateRow()]
      }
      return []
    }
    const repository = createCertificateRepository({ query })

    await expect(repository.getCertificateForLearner(learnerId, certificateId)).resolves.toMatchObject({
      certificateId,
      verificationCode,
    })
  })

  it('supports public verification by opaque verification code without exposing account metadata', async () => {
    const query = async (text: string, values?: readonly unknown[]) => {
      if (text.includes('certificate.verification_code = $1')) {
        expect(values).toEqual([verificationCode])
        return [certificateRow()]
      }
      return []
    }
    const repository = createCertificateRepository({ query })

    await expect(repository.getCertificateByVerificationCode(verificationCode)).resolves.toEqual({
      certificateId,
      certificateNumber: 'SNS-2026-A1B2C3D4E5F6',
      verificationCode,
      learnerName: 'Aarav Mehta',
      courseTitle: 'SIRE 2.0 Readiness',
      mentorName: 'Capt. Maya Singh',
      completedAt: '2026-09-15T08:00:00.000Z',
      issuedAt: '2026-09-15T08:01:00.000Z',
    })
  })

  it('issues an organization-course certificate using the organization name as publisher', async () => {
    const query = async (text: string) => {
      if (text.includes('from public.learning_enrollments enrollment') && text.includes('learner.full_name')) {
        return [{
          enrollment_id: enrollmentId,
          course_id: courseId,
          learner_id: learnerId,
          learner_name: 'Aarav Mehta',
          course_title: 'Bridge Resource Management',
          mentor_name: 'Sea Academy',
          completed_at: new Date('2026-09-15T08:00:00.000Z'),
        }]
      }
      if (text.includes('insert into public.learning_certificates')) {
        return [{
          ...certificateRow(),
          course_title: 'Bridge Resource Management',
          mentor_name: 'Sea Academy',
        }]
      }
      return []
    }

    await expect(issueCertificateForCompletedEnrollmentWithQuery(query, enrollmentId)).resolves.toMatchObject({
      courseTitle: 'Bridge Resource Management',
      mentorName: 'Sea Academy',
    })
  })

})
