import { z } from 'zod'

function normalizedStringList({
  itemMaximum,
  minimumItems = 0,
  maximumItems,
}: {
  itemMaximum: number
  minimumItems?: number
  maximumItems: number
}) {
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
    z.array(z.string().min(1).max(itemMaximum)).min(minimumItems).max(maximumItems),
  )
}

const yearsExperienceSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value
    const normalized = value.trim()
    return normalized ? Number(normalized) : Number.NaN
  },
  z.number().finite().min(0).max(70),
)

const optionalProfilePhotoPath = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  z.string().min(1).max(1024).nullable(),
)

const optionalLinkedInUrl = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  z.string()
    .url('Add a valid LinkedIn profile URL.')
    .max(320)
    .nullable()
    .refine((value) => {
      if (value === null) return true
      const url = new URL(value)
      return url.protocol === 'https:' && (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com'))
    }, 'Add a valid LinkedIn profile URL.'),
)

export const mentorApplicationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  currentLastRank: z.string().trim().min(2).max(120),
  yearsExperience: yearsExperienceSchema,
  vesselTypes: normalizedStringList({ itemMaximum: 120, minimumItems: 1, maximumItems: 20 }),
  specialization: z.string().trim().min(2).max(500),
  certifications: normalizedStringList({ itemMaximum: 160, minimumItems: 1, maximumItems: 30 }),
  linkedInUrl: optionalLinkedInUrl,
  shortBio: z.string().trim().min(40).max(1500),
  profilePhotoPath: optionalProfilePhotoPath,
  proposedCourseTopics: normalizedStringList({ itemMaximum: 160, minimumItems: 1, maximumItems: 12 }),
})

export type MentorApplicationInput = z.infer<typeof mentorApplicationSchema>

export const MENTOR_APPLICATION_STATUSES = [
  'pending',
  'changes_requested',
  'approved',
  'rejected',
] as const

export type MentorApplicationStatus = (typeof MENTOR_APPLICATION_STATUSES)[number]
export type MentorApplicationActor = 'applicant' | 'administrator'

export type MentorApplicationStatusTransition = {
  actor: MentorApplicationActor
  current: MentorApplicationStatus
  next: MentorApplicationStatus
}

const MENTOR_APPLICATION_TRANSITIONS: Record<
  MentorApplicationActor,
  Partial<Record<MentorApplicationStatus, readonly MentorApplicationStatus[]>>
> = {
  applicant: {
    changes_requested: ['pending'],
    rejected: ['pending'],
  },
  administrator: {
    pending: ['changes_requested', 'approved', 'rejected'],
  },
}

export function canTransitionMentorApplicationStatus(input: MentorApplicationStatusTransition): boolean {
  return MENTOR_APPLICATION_TRANSITIONS[input.actor][input.current]?.includes(input.next) ?? false
}

export function canApplicantEditMentorApplication(status: MentorApplicationStatus): boolean {
  return status === 'changes_requested' || status === 'rejected'
}
