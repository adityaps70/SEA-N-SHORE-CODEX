import { z } from 'zod'

/**
 * Learning round B (B4): what a course's certificate looks like and when it is issued. Client-safe.
 * A certificate copies these values when it is issued, so later changes never alter an issued certificate.
 */

export const CERTIFICATE_TEMPLATES = ['classic', 'modern', 'formal', 'minimal'] as const
export type CertificateTemplate = (typeof CERTIFICATE_TEMPLATES)[number]

export const CERTIFICATE_TEMPLATE_LABELS: Record<CertificateTemplate, { label: string; description: string }> = {
  classic: { label: 'Classic', description: 'The original Sea N Shore certificate: framed, centred, ocean blue.' },
  modern: { label: 'Modern', description: 'A navy band on the left, large name, clean type.' },
  formal: { label: 'Formal', description: 'Double gold-and-navy border with a seal, for regulated training.' },
  minimal: { label: 'Minimal', description: 'Plenty of white space and a thin teal rule.' },
}

export const CERTIFICATE_ISSUE_TRIGGERS = ['course_completion', 'final_quiz'] as const
export type CertificateIssueTrigger = (typeof CERTIFICATE_ISSUE_TRIGGERS)[number]

export type CourseCertificateSettings = {
  template: CertificateTemplate
  logoPath: string | null
  signaturePath: string | null
  signatoryName: string | null
  signatoryTitle: string | null
  /** "SNS-SIRE-": serials read SNS-SIRE-2026-1A2B3C4D. Null: only the standard certificate number. */
  serialPrefix: string | null
  /** Null: never expires. */
  validityMonths: number | null
  issueTrigger: CertificateIssueTrigger
  /** The quiz that issues the certificate when the trigger is final_quiz. */
  finalLessonId: string | null
}

export const DEFAULT_CERTIFICATE_SETTINGS: CourseCertificateSettings = {
  template: 'classic',
  logoPath: null,
  signaturePath: null,
  signatoryName: null,
  signatoryTitle: null,
  serialPrefix: null,
  validityMonths: null,
  issueTrigger: 'course_completion',
  finalLessonId: null,
}

/** "sns sire" → "SNS-SIRE-"; returns null for an empty prefix. Throws nothing; invalid input is caught by the schema. */
export function normaliseSerialPrefix(value: string | null | undefined) {
  const cleaned = (value ?? '').toUpperCase().trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-/, '')
  if (!cleaned) return null
  return cleaned.endsWith('-') ? cleaned : `${cleaned}-`
}

export const SERIAL_PREFIX_PATTERN = /^[A-Z0-9]{1,10}(-[A-Z0-9]{1,10}){0,3}-$/

const optionalName = z.string().trim().max(120).nullable().optional().transform((value) => value || null)
  .refine((value) => value === null || value.length >= 2, 'Names and titles need at least 2 characters.')

export const certificateSettingsSchema = z.object({
  template: z.enum(CERTIFICATE_TEMPLATES),
  logoPath: z.string().min(1).max(500).nullable(),
  signaturePath: z.string().min(1).max(500).nullable(),
  signatoryName: optionalName,
  signatoryTitle: optionalName,
  serialPrefix: z.string().max(40).nullable().optional().transform((value) => normaliseSerialPrefix(value))
    .refine((value) => value === null || SERIAL_PREFIX_PATTERN.test(value), 'Use letters and numbers in up to four parts, like SNS-SIRE.'),
  validityMonths: z.number().int().min(1, 'Validity is at least 1 month.').max(120, 'Validity is at most 120 months (10 years).').nullable(),
  issueTrigger: z.enum(CERTIFICATE_ISSUE_TRIGGERS),
  finalLessonId: z.string().uuid().nullable(),
}).superRefine((value, context) => {
  if (value.issueTrigger === 'final_quiz' && !value.finalLessonId) {
    context.addIssue({ code: 'custom', path: ['finalLessonId'], message: 'Choose the final quiz that issues the certificate.' })
  }
})

type SettingsRow = {
  certificate_template?: string | null
  certificate_logo_path?: string | null
  certificate_signature_path?: string | null
  certificate_signatory_name?: string | null
  certificate_signatory_title?: string | null
  certificate_serial_prefix?: string | null
  certificate_validity_months?: string | number | null
  certificate_issue_trigger?: string | null
  certificate_final_lesson_id?: string | null
}

export function certificateSettingsFromRow(row: SettingsRow): CourseCertificateSettings {
  return {
    template: (CERTIFICATE_TEMPLATES as readonly string[]).includes(row.certificate_template ?? '') ? row.certificate_template as CertificateTemplate : 'classic',
    logoPath: row.certificate_logo_path ?? null,
    signaturePath: row.certificate_signature_path ?? null,
    signatoryName: row.certificate_signatory_name ?? null,
    signatoryTitle: row.certificate_signatory_title ?? null,
    serialPrefix: row.certificate_serial_prefix ?? null,
    validityMonths: row.certificate_validity_months === null || row.certificate_validity_months === undefined ? null : Number(row.certificate_validity_months),
    issueTrigger: row.certificate_issue_trigger === 'final_quiz' ? 'final_quiz' : 'course_completion',
    finalLessonId: row.certificate_final_lesson_id ?? null,
  }
}

/** Valid until a date, or never; expired once that moment has passed. */
export function certificateValidity(expiresAt: string | null, now = new Date()) {
  if (!expiresAt) return { status: 'valid' as const, expiresAt: null }
  return { status: new Date(expiresAt).getTime() <= now.getTime() ? 'expired' as const : 'valid' as const, expiresAt }
}

/** The number shown on a certificate: its serial when the course set a prefix, else the standard number. */
export function certificateDisplayNumber(certificate: { certificateNumber: string; serialNumber?: string | null }) {
  return certificate.serialNumber ?? certificate.certificateNumber
}
