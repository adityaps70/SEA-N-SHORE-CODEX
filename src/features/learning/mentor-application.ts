import { z } from 'zod'

type ListMessages = { required: string; tooMany: string; itemTooLong: string }

/**
 * A comma-separated list (or an array): items are trimmed, blank items (",,", a trailing comma) and repeats are
 * dropped before counting, so "Topic A, , topic a," is one topic.
 */
export function normalizeListInput(value: unknown) {
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
}

function normalizedStringList({
  itemMaximum,
  minimumItems = 0,
  maximumItems,
  messages,
}: {
  itemMaximum: number
  minimumItems?: number
  maximumItems: number
  messages: ListMessages
}) {
  return z.preprocess(
    normalizeListInput,
    z.array(z.string().min(1).max(itemMaximum, messages.itemTooLong))
      .min(minimumItems, messages.required)
      .max(maximumItems, messages.tooMany),
  )
}

const yearsExperienceSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value
    const normalized = value.trim()
    return normalized ? Number(normalized) : Number.NaN
  },
  z.number('Enter your years of maritime experience, from 0 to 70.')
    .finite('Enter your years of maritime experience, from 0 to 70.')
    .min(0, 'Enter your years of maritime experience, from 0 to 70.')
    .max(70, 'Enter your years of maritime experience, from 0 to 70.'),
)

const optionalProfilePhotoPath = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  z.string().min(1).max(1024).nullable(),
)

const LINKEDIN_MESSAGE = 'Add your LinkedIn profile address, starting with https://www.linkedin.com/, or leave it empty.'

function isLinkedInUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com'))
  } catch {
    return false
  }
}

const optionalLinkedInUrl = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  // One check (no separate .url()): an address the URL parser rejects fails here instead of throwing.
  z.string()
    .max(320, 'Your LinkedIn profile address can be at most 320 characters.')
    .refine(isLinkedInUrl, LINKEDIN_MESSAGE)
    .nullable(),
)

/** The plain message shown under "Proposed course topics" when it is empty (client and server say the same). */
export const COURSE_TOPICS_REQUIRED_MESSAGE = 'Add at least one course topic, separated by commas'

export const mentorApplicationSchema = z.object({
  name: z.string().trim()
    .min(2, 'Enter your name.')
    .max(120, 'Your name can be at most 120 characters.'),
  currentLastRank: z.string().trim()
    .min(2, 'Enter your current or last rank.')
    .max(120, 'Your rank can be at most 120 characters.'),
  yearsExperience: yearsExperienceSchema,
  vesselTypes: normalizedStringList({
    itemMaximum: 120,
    minimumItems: 1,
    maximumItems: 20,
    messages: {
      required: 'Add at least one vessel type, separated by commas',
      tooMany: 'List at most 20 vessel types.',
      itemTooLong: 'Each vessel type can be at most 120 characters.',
    },
  }),
  specialization: z.string().trim()
    .min(2, 'Describe your specialization.')
    .max(500, 'Your specialization can be at most 500 characters.'),
  certifications: normalizedStringList({
    itemMaximum: 160,
    minimumItems: 1,
    maximumItems: 30,
    messages: {
      required: 'Add at least one certification, separated by commas',
      tooMany: 'List at most 30 certifications.',
      itemTooLong: 'Each certification can be at most 160 characters.',
    },
  }),
  linkedInUrl: optionalLinkedInUrl,
  shortBio: z.string().trim()
    .min(40, 'Write a short bio of at least 40 characters.')
    .max(1500, 'Keep your short bio to 1,500 characters.'),
  profilePhotoPath: optionalProfilePhotoPath,
  proposedCourseTopics: normalizedStringList({
    itemMaximum: 160,
    minimumItems: 1,
    maximumItems: 12,
    messages: {
      required: COURSE_TOPICS_REQUIRED_MESSAGE,
      tooMany: 'List at most 12 course topics.',
      itemTooLong: 'Each course topic can be at most 160 characters.',
    },
  }),
})

/** Field names as the form shows them, for any message a rule does not word itself. */
export const MENTOR_APPLICATION_FIELD_LABELS = {
  name: 'Name',
  currentLastRank: 'Current / last rank',
  yearsExperience: 'Years of maritime experience',
  vesselTypes: 'Vessel types',
  specialization: 'Specialization',
  certifications: 'Certifications',
  linkedInUrl: 'LinkedIn profile',
  shortBio: 'Short bio',
  profilePhotoPath: 'Profile photo',
  proposedCourseTopics: 'Proposed course topics',
} as const

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
