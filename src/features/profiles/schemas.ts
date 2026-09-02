import { z } from 'zod'
import { PROFILE_TYPES } from './types'

const normalizeTerms = (value: unknown) => {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const seen = new Set<string>()

  return source.flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const term = entry.trim()
    const key = term.toLocaleLowerCase('en')
    if (!term || seen.has(key)) return []
    seen.add(key)
    return [term]
  })
}

const termsSchema = z.preprocess(
  normalizeTerms,
  z.array(z.string().min(1).max(80, 'Keep every entry to 80 characters or fewer.')).max(20, 'Add no more than 20 entries.'),
)

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return undefined
      const normalized = value.trim()
      return normalized || undefined
    },
    z.string().max(maximum).optional(),
  )

const sailingExperienceSchema = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return undefined
    if (typeof value === 'string' && value.trim() === '') return undefined
    return typeof value === 'string' ? Number(value) : value
  },
  z.number().finite().min(0).max(70).optional(),
)

const discardIrrelevantMaritimeValues = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const source = value as Record<string, unknown>
  if (source.profileType === 'seafarer' || source.profileType === 'maritime_professional') return source

  return {
    ...source,
    rank: undefined,
    currentCompany: undefined,
    currentVessel: undefined,
    sailingExperienceYears: undefined,
    vesselTypes: undefined,
    tradingAreas: undefined,
    shoreCareerPreference: undefined,
    availability: undefined,
  }
}

const onboardingFieldsSchema = z
  .object({
    profileType: z.enum(PROFILE_TYPES, { error: 'Choose the professional profile that fits you best.' }),
    fullName: z.string().trim().min(2, 'Add your full name.').max(120),
    slug: z.preprocess(
      (value) => typeof value === 'string' ? value.trim().toLocaleLowerCase('en') : value,
      z
        .string()
        .min(1, 'Choose a profile address.')
        .max(80)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letters, numbers, and single hyphens.'),
    ),
    location: optionalText(120),
    headline: z.string().trim().min(4, 'Add a professional headline.').max(160),
    summary: z.string().trim().min(20, 'Write at least 20 characters.').max(2000),
    contactVisibility: z.enum(['private', 'members', 'public']),
    skills: termsSchema,
    rank: optionalText(100),
    currentCompany: optionalText(160),
    currentVessel: optionalText(160),
    sailingExperienceYears: sailingExperienceSchema,
    vesselTypes: termsSchema,
    tradingAreas: termsSchema,
    shoreCareerPreference: z.preprocess(
      (value) => value === true || value === 'true' || value === 'on',
      z.boolean(),
    ),
    availability: optionalText(100),
  })
  .superRefine((data, context) => {
    if (data.profileType === 'seafarer' && (!data.rank || data.rank.length < 2)) {
      context.addIssue({ code: 'custom', path: ['rank'], message: 'Add your current or most recent rank.' })
    }
  })

export const onboardingSchema = z.preprocess(discardIrrelevantMaritimeValues, onboardingFieldsSchema)

export type OnboardingInput = z.infer<typeof onboardingSchema>
