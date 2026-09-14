import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'

export type CertificateQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type CertificateTransaction = <T>(work: (query: CertificateQuery) => Promise<T>) => Promise<T>

export type LearningCertificate = {
  certificateId: string
  enrollmentId: string
  courseId: string
  learnerId: string
  certificateNumber: string
  verificationCode: string
  learnerName: string
  courseTitle: string
  mentorName: string
  completedAt: string
  issuedAt: string
}

export type PublicLearningCertificate = Omit<LearningCertificate, 'enrollmentId' | 'courseId' | 'learnerId'>

type EligibleEnrollmentRow = QueryResultRow & {
  enrollment_id: string
  course_id: string
  learner_id: string
  learner_name: string
  course_title: string
  mentor_name: string
  completed_at: string | Date
}

type CertificateRow = QueryResultRow & {
  id: string
  enrollment_id: string
  course_id: string
  learner_id: string
  certificate_number: string
  verification_code: string
  learner_name: string
  course_title: string
  mentor_name: string
  completed_at: string | Date
  issued_at: string | Date
}

type EnrollmentOwnershipRow = QueryResultRow & { id: string }

function runtimeTransaction<T>(work: (query: CertificateQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function isoDateTime(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

function mapCertificate(row: CertificateRow): LearningCertificate {
  return {
    certificateId: row.id,
    enrollmentId: row.enrollment_id,
    courseId: row.course_id,
    learnerId: row.learner_id,
    certificateNumber: row.certificate_number,
    verificationCode: row.verification_code,
    learnerName: row.learner_name,
    courseTitle: row.course_title,
    mentorName: row.mentor_name,
    completedAt: isoDateTime(row.completed_at),
    issuedAt: isoDateTime(row.issued_at),
  }
}

function publicCertificate(certificate: LearningCertificate): PublicLearningCertificate {
  const { enrollmentId: _enrollmentId, courseId: _courseId, learnerId: _learnerId, ...publicEvidence } = certificate
  return publicEvidence
}

const CERTIFICATE_SELECT = `
  select
    certificate.id,
    certificate.enrollment_id,
    certificate.course_id,
    certificate.learner_id,
    certificate.certificate_number,
    certificate.verification_code,
    certificate.learner_name,
    certificate.course_title,
    certificate.mentor_name,
    certificate.completed_at,
    certificate.issued_at
  from public.learning_certificates certificate
` as const

export async function issueCertificateForCompletedEnrollmentWithQuery(
  query: CertificateQuery,
  enrollmentId: string,
): Promise<LearningCertificate | null> {
  const eligibleRows = await query(
    `select
       enrollment.id as enrollment_id,
       enrollment.course_id,
       enrollment.learner_id,
       learner.full_name as learner_name,
       course.title as course_title,
       application.applicant_name as mentor_name,
       enrollment.completed_at
     from public.learning_enrollments enrollment
     inner join public.learning_courses course
       on course.id = enrollment.course_id
     inner join public.profiles learner
       on learner.id = enrollment.learner_id
     inner join public.learning_mentors mentor
       on mentor.id = course.mentor_id
     inner join public.learning_mentor_applications application
       on application.id = mentor.application_id
     where enrollment.id = $1
       and enrollment.status = 'completed'
       and enrollment.completed_at is not null
       and course.certificate_enabled = true
     limit 1`,
    [enrollmentId],
  ) as EligibleEnrollmentRow[]

  const eligible = eligibleRows[0]
  if (!eligible) return null

  const certificateRows = await query(
    `insert into public.learning_certificates (
       enrollment_id,
       course_id,
       learner_id,
       learner_name,
       course_title,
       mentor_name,
       completed_at
     )
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (enrollment_id) do update
     set enrollment_id = excluded.enrollment_id
     returning
       id,
       enrollment_id,
       course_id,
       learner_id,
       certificate_number,
       verification_code,
       learner_name,
       course_title,
       mentor_name,
       completed_at,
       issued_at`,
    [
      eligible.enrollment_id,
      eligible.course_id,
      eligible.learner_id,
      eligible.learner_name,
      eligible.course_title,
      eligible.mentor_name,
      eligible.completed_at,
    ],
  ) as CertificateRow[]

  const certificate = certificateRows[0]
  if (!certificate) throw new Error('certificate_issue_failed')
  return mapCertificate(certificate)
}

export function createCertificateRepository(input: {
  query?: CertificateQuery
  transaction?: CertificateTransaction
} = {}) {
  const queryRows: CertificateQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function ensureCertificateForEnrollment(learnerId: string, enrollmentId: string) {
    return transaction(async (query) => {
      const ownershipRows = await query(
        `select id
         from public.learning_enrollments
         where learner_id = $1
           and id = $2
         for update`,
        [learnerId, enrollmentId],
      ) as EnrollmentOwnershipRow[]
      if (!ownershipRows[0]) throw new Error('certificate_enrollment_not_accessible')
      return issueCertificateForCompletedEnrollmentWithQuery(query, enrollmentId)
    })
  }

  async function getCertificateForLearner(learnerId: string, certificateId: string) {
    const rows = await queryRows(
      `${CERTIFICATE_SELECT}
       where certificate.learner_id = $1
         and certificate.id = $2
       limit 1`,
      [learnerId, certificateId],
    ) as CertificateRow[]
    return rows[0] ? mapCertificate(rows[0]) : null
  }

  async function getCertificateByVerificationCode(verificationCode: string): Promise<PublicLearningCertificate | null> {
    const rows = await queryRows(
      `${CERTIFICATE_SELECT}
       where certificate.verification_code = $1
       limit 1`,
      [verificationCode],
    ) as CertificateRow[]
    return rows[0] ? publicCertificate(mapCertificate(rows[0])) : null
  }

  async function getCertificateForEnrollment(learnerId: string, enrollmentId: string) {
    const rows = await queryRows(
      `${CERTIFICATE_SELECT}
       where certificate.learner_id = $1
         and certificate.enrollment_id = $2
       limit 1`,
      [learnerId, enrollmentId],
    ) as CertificateRow[]
    return rows[0] ? mapCertificate(rows[0]) : null
  }

  return {
    ensureCertificateForEnrollment,
    getCertificateForLearner,
    getCertificateByVerificationCode,
    getCertificateForEnrollment,
  }
}

export const certificateRepository = createCertificateRepository()
