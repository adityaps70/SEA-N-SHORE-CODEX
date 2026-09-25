import { z } from 'zod'

export const CREATOR_VERIFICATION_TYPES = ['recruiter', 'event_host'] as const
export type CreatorVerificationType = (typeof CREATOR_VERIFICATION_TYPES)[number]

export const CREATOR_VERIFICATION_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const
export type CreatorVerificationStatus = (typeof CREATOR_VERIFICATION_STATUSES)[number]

export const CREATOR_VERIFICATION_SOURCES = [
  'application',
  'company_membership',
  'mentor_approval',
  'legacy_event_host',
  'admin',
] as const
export type CreatorVerificationSource = (typeof CREATOR_VERIFICATION_SOURCES)[number]

function normalizedStringList(maximumItems: number) {
  return z.preprocess(
    (value) => {
      const source = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split(',')
          : []
      const seen = new Set<string>()
      return source.flatMap((entry) => {
        if (typeof entry !== 'string') return []
        const normalized = entry.trim()
        const key = normalized.toLocaleLowerCase('en')
        if (!normalized || seen.has(key)) return []
        seen.add(key)
        return [normalized]
      })
    },
    z.array(z.string().min(2).max(120)).min(1, 'Add at least one area of experience.').max(maximumItems),
  )
}

const optionalText = (maximum: number) => z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  z.string().max(maximum).nullable(),
)

const evidenceUrl = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  z.string()
    .url('Add a valid public evidence URL.')
    .max(500)
    .nullable()
    .refine((value) => value === null || new URL(value).protocol === 'https:', 'Use an HTTPS evidence URL.'),
)

export const creatorVerificationApplicationSchema = z.object({
  professionalRole: z.string().trim().min(2, 'Add your professional role.').max(120),
  organizationName: optionalText(160),
  experienceYears: z.preprocess(
    (value) => {
      if (typeof value === 'number') return value
      if (typeof value !== 'string') return Number.NaN
      const normalized = value.trim()
      return normalized ? Number(normalized) : Number.NaN
    },
    z.number().finite().min(0, 'Experience cannot be negative.').max(70, 'Check the years of experience.'),
  ),
  specializations: normalizedStringList(12),
  experienceSummary: z.string().trim()
    .min(60, 'Add more detail about your relevant experience.')
    .max(2000, 'Keep the experience summary to 2,000 characters or fewer.'),
  evidenceUrl,
  additionalNote: optionalText(1000),
})

export type CreatorVerificationApplication = z.infer<typeof creatorVerificationApplicationSchema>

export type CreatorVerificationState = {
  id: string
  type: CreatorVerificationType
  status: CreatorVerificationStatus
  source: CreatorVerificationSource
  application: CreatorVerificationApplication | null
  submittedAt: string
  reviewedAt: string | null
  reviewNote: string | null
}

export type AdminCreatorVerificationApplication = CreatorVerificationState & {
  applicant: {
    id: string
    fullName: string
    slug: string | null
    headline: string | null
  }
}
