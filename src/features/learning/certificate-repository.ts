import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { coursePublisherNameSql } from './course-publication'
import { notifyCertificateIssued } from './learning-notifications'
import { CERTIFICATE_TEMPLATES, type CertificateTemplate } from './certificate-settings'
import { attendanceRuleMetSql } from './sessions/attendance-sql'

const VERIFICATION_CODE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
} & Partial<CertificateDesign>

/** Learning round B (B4): copied from the course when issued. Certificates issued before have no template key. */
export type CertificateDesign = {
  /** Null: the original layout (certificates issued before round B). */
  templateKey: CertificateTemplate | null
  serialNumber: string | null
  /** Null: never expires. */
  expiresAt: string | null
  logoPath: string | null
  signaturePath: string | null
  signatoryName: string | null
  signatoryTitle: string | null
  hiddenFromProfile: boolean
}

export type ProfileLearningCertificate = {
  certificateId: string
  courseTitle: string
  issuer: string
  number: string
  issuedAt: string
  expiresAt: string | null
  verificationCode: string
  hidden: boolean
  /** Worked out on the server when the profile was read. */
  expired: boolean
}

/** A certificate on the learner's own My Learning page (learning round C, C6). */
export type LearnerCertificateSummary = {
  certificateId: string
  enrollmentId: string
  courseTitle: string
  issuedAt: string
  /** Null: never expires. */
  expiresAt: string | null
  verificationCode: string
  /** Worked out on the server when the list was read. */
  expired: boolean
}

export type PublicLearningCertificate = Omit<LearningCertificate, 'enrollmentId' | 'courseId' | 'learnerId' | 'logoPath' | 'signaturePath' | 'hiddenFromProfile'>

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
  template_key?: string | null
  serial_number?: string | null
  expires_at?: string | Date | null
  logo_path?: string | null
  signature_path?: string | null
  signatory_name?: string | null
  signatory_title?: string | null
  hidden_from_profile?: boolean | null
  /** True when this call inserted the certificate (it did not exist yet). */
  inserted?: boolean
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
    ...(row.template_key !== undefined
      ? {
          templateKey: (CERTIFICATE_TEMPLATES as readonly string[]).includes(row.template_key ?? '') ? row.template_key as CertificateTemplate : null,
          serialNumber: row.serial_number ?? null,
          expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
          logoPath: row.logo_path ?? null,
          signaturePath: row.signature_path ?? null,
          signatoryName: row.signatory_name ?? null,
          signatoryTitle: row.signatory_title ?? null,
          hiddenFromProfile: row.hidden_from_profile ?? false,
        }
      : {}),
  }
}

function publicCertificate(certificate: LearningCertificate): PublicLearningCertificate {
  return {
    certificateId: certificate.certificateId,
    certificateNumber: certificate.certificateNumber,
    verificationCode: certificate.verificationCode,
    learnerName: certificate.learnerName,
    courseTitle: certificate.courseTitle,
    mentorName: certificate.mentorName,
    completedAt: certificate.completedAt,
    issuedAt: certificate.issuedAt,
    ...(certificate.templateKey !== undefined
      ? {
          templateKey: certificate.templateKey,
          serialNumber: certificate.serialNumber ?? null,
          expiresAt: certificate.expiresAt ?? null,
          signatoryName: certificate.signatoryName ?? null,
          signatoryTitle: certificate.signatoryTitle ?? null,
        }
      : {}),
  }
}

const CERTIFICATE_COLUMNS = `id,
       enrollment_id,
       course_id,
       learner_id,
       certificate_number,
       verification_code,
       learner_name,
       course_title,
       mentor_name,
       completed_at,
       issued_at,
       template_key,
       serial_number,
       expires_at,
       logo_path,
       signature_path,
       signatory_name,
       signatory_title,
       hidden_from_profile`

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
    certificate.issued_at,
    certificate.template_key,
    certificate.serial_number,
    certificate.expires_at,
    certificate.logo_path,
    certificate.signature_path,
    certificate.signatory_name,
    certificate.signatory_title,
    certificate.hidden_from_profile
  from public.learning_certificates certificate
` as const

type IssueContextRow = EligibleEnrollmentRow & {
  certificate_template?: string | null
  certificate_logo_path?: string | null
  certificate_signature_path?: string | null
  certificate_signatory_name?: string | null
  certificate_signatory_title?: string | null
  certificate_serial_prefix?: string | null
  certificate_validity_months?: string | number | null
  certificate_issue_trigger?: string | null
}

const ISSUE_CONTEXT_SELECT = `select
       enrollment.id as enrollment_id,
       enrollment.course_id,
       enrollment.learner_id,
       learner.full_name as learner_name,
       course.title as course_title,
       ${coursePublisherNameSql()} as mentor_name,
       enrollment.completed_at,
       course.certificate_template,
       course.certificate_logo_path,
       course.certificate_signature_path,
       course.certificate_signatory_name,
       course.certificate_signatory_title,
       course.certificate_serial_prefix,
       course.certificate_validity_months,
       course.certificate_issue_trigger
     from public.learning_enrollments enrollment
     inner join public.learning_courses course
       on course.id = enrollment.course_id
     inner join public.profiles learner
       on learner.id = enrollment.learner_id
     left join public.learning_mentors mentor
       on mentor.id = course.mentor_id
     left join public.learning_mentor_applications application
       on application.id = mentor.application_id
     left join public.companies company
       on company.id = course.company_id`

/**
 * Writes the certificate once per enrolment, copying the course's design, serial prefix and validity as they are
 * now (learning round B), so later course edits never change an issued certificate. Announced only when new.
 */
async function insertCertificate(query: CertificateQuery, eligible: IssueContextRow, completedAt: string | Date, issuedFor: 'course_completion' | 'final_quiz') {
  const certificateRows = await query(
    `insert into public.learning_certificates (
       enrollment_id,
       course_id,
       learner_id,
       learner_name,
       course_title,
       mentor_name,
       completed_at,
       template_key,
       serial_number,
       expires_at,
       logo_path,
       signature_path,
       signatory_name,
       signatory_title,
       issued_for
     )
     values (
       $1, $2, $3, $4, $5, $6, $7, $8,
       case when $9::text is null then null
            else $9::text || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)) end,
       case when $10::integer is null then null else now() + make_interval(months => $10::integer) end,
       $11, $12, $13, $14, $15
     )
     on conflict (enrollment_id) do update
     set enrollment_id = excluded.enrollment_id
     returning
       (xmax = 0) as inserted,
       ${CERTIFICATE_COLUMNS}`,
    [
      eligible.enrollment_id,
      eligible.course_id,
      eligible.learner_id,
      eligible.learner_name,
      eligible.course_title,
      eligible.mentor_name,
      completedAt,
      eligible.certificate_template ?? 'classic',
      eligible.certificate_serial_prefix ?? null,
      eligible.certificate_validity_months === null || eligible.certificate_validity_months === undefined ? null : Number(eligible.certificate_validity_months),
      eligible.certificate_logo_path ?? null,
      eligible.certificate_signature_path ?? null,
      eligible.certificate_signatory_name ?? null,
      eligible.certificate_signatory_title ?? null,
      issuedFor,
    ],
  ) as CertificateRow[]

  const certificate = certificateRows[0]
  if (!certificate) throw new Error('certificate_issue_failed')
  // Only a certificate issued just now is announced; asking for an existing one again is silent.
  if (certificate.inserted === true) {
    await notifyCertificateIssued(query, {
      learnerId: certificate.learner_id,
      courseId: certificate.course_id,
      enrollmentId: certificate.enrollment_id,
      courseTitle: certificate.course_title,
      verificationCode: certificate.verification_code,
    })
  }
  return mapCertificate(certificate)
}

async function existingCertificate(query: CertificateQuery, enrollmentId: string) {
  const rows = await query(`${CERTIFICATE_SELECT} where certificate.enrollment_id = $1 limit 1`, [enrollmentId]) as CertificateRow[]
  return rows[0] ? mapCertificate(rows[0]) : null
}

export async function issueCertificateForCompletedEnrollmentWithQuery(
  query: CertificateQuery,
  enrollmentId: string,
): Promise<LearningCertificate | null> {
  const eligibleRows = await query(
    `${ISSUE_CONTEXT_SELECT}
     where enrollment.id = $1
       and enrollment.status = 'completed'
       and enrollment.completed_at is not null
       and course.certificate_enabled = true
       and ${attendanceRuleMetSql()}
     limit 1`,
    [enrollmentId],
  ) as IssueContextRow[]

  const eligible = eligibleRows[0]
  if (!eligible) return null
  // A course that issues on its final quiz does not issue on completion (the quiz pass already did).
  if (eligible.certificate_issue_trigger === 'final_quiz') return existingCertificate(query, enrollmentId)
  return insertCertificate(query, eligible, eligible.completed_at, 'course_completion')
}

/**
 * Learning round B (B4): a course set to issue on its final quiz issues the certificate when that quiz is passed
 * (after grading, for written answers), whether or not every other material is complete.
 */
export async function issueCertificateForFinalQuizWithQuery(
  query: CertificateQuery,
  enrollmentId: string,
  lessonId: string,
): Promise<LearningCertificate | null> {
  const eligibleRows = await query(
    `${ISSUE_CONTEXT_SELECT}
     inner join public.learning_lessons final_lesson
       on final_lesson.id = $2
      and final_lesson.certificate_final = true
      and final_lesson.removed_at is null
     inner join public.learning_course_sections final_section
       on final_section.id = final_lesson.section_id
      and final_section.course_id = course.id
     where enrollment.id = $1
       and enrollment.status in ('active', 'completed')
       and course.certificate_enabled = true
       and course.certificate_issue_trigger = 'final_quiz'
       and ${attendanceRuleMetSql()}
     limit 1`,
    [enrollmentId, lessonId],
  ) as IssueContextRow[]
  const eligible = eligibleRows[0]
  if (!eligible) return null
  return insertCertificate(query, eligible, new Date().toISOString(), 'final_quiz')
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
      // An issued certificate (on completion, or on the final quiz) is returned as it is.
      return await existingCertificate(query, enrollmentId) ?? issueCertificateForCompletedEnrollmentWithQuery(query, enrollmentId)
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
    // The column is a uuid: a code that cannot be one matches nothing (and must not reach the comparison).
    if (!VERIFICATION_CODE_PATTERN.test(verificationCode)) return null
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

  /**
   * Sea N Shore certificates for a profile's Licences & Credentials (round B, B5). The public profile leaves out
   * those the member hid; the owner sees every one with its hide switch.
   */
  async function listForProfile(profileId: string, options: { includeHidden: boolean }): Promise<ProfileLearningCertificate[]> {
    const rows = await queryRows(
      `${CERTIFICATE_SELECT}
       where certificate.learner_id = $1
         and ($2::boolean or certificate.hidden_from_profile = false)
       order by certificate.issued_at desc, certificate.id desc`,
      [profileId, options.includeHidden],
    ) as CertificateRow[]
    return rows.map((row) => {
      const certificate = mapCertificate(row)
      return {
        certificateId: certificate.certificateId,
        courseTitle: certificate.courseTitle,
        issuer: certificate.mentorName,
        number: certificate.serialNumber ?? certificate.certificateNumber,
        issuedAt: certificate.issuedAt,
        expiresAt: certificate.expiresAt ?? null,
        verificationCode: certificate.verificationCode,
        hidden: certificate.hiddenFromProfile ?? false,
        expired: certificate.expiresAt ? new Date(certificate.expiresAt).getTime() <= Date.now() : false,
      }
    })
  }

  /** Every certificate the learner holds, newest first, for their own My Learning page (round C, C6). */
  async function listForLearner(learnerId: string): Promise<LearnerCertificateSummary[]> {
    const rows = await queryRows(
      `${CERTIFICATE_SELECT}
       where certificate.learner_id = $1
       order by certificate.issued_at desc, certificate.id desc`,
      [learnerId],
    ) as CertificateRow[]
    return rows.map((row) => {
      const certificate = mapCertificate(row)
      const expiresAt = certificate.expiresAt ?? null
      return {
        certificateId: certificate.certificateId,
        enrollmentId: certificate.enrollmentId,
        courseTitle: certificate.courseTitle,
        issuedAt: certificate.issuedAt,
        expiresAt,
        verificationCode: certificate.verificationCode,
        expired: expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false,
      }
    })
  }

  /** The member shows or hides one of their own certificates on their profile. */
  async function setHiddenFromProfile(learnerId: string, certificateId: string, hidden: boolean) {
    const rows = await queryRows(
      `update public.learning_certificates set hidden_from_profile = $3
       where id = $2 and learner_id = $1
       returning id`,
      [learnerId, certificateId, hidden],
    )
    if (!rows[0]) throw new Error('certificate_not_found')
    return true
  }

  return {
    listForProfile,
    listForLearner,
    setHiddenFromProfile,
    ensureCertificateForEnrollment,
    getCertificateForLearner,
    getCertificateByVerificationCode,
    getCertificateForEnrollment,
  }
}

export const certificateRepository = createCertificateRepository()
