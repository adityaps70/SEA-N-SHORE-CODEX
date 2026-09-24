import { z } from 'zod'
import {
  defaultHeadlineForPersona,
  PERSONAS,
  PROFILE_INTENTS,
  personaUsesProfessionalCompany,
} from './persona'
import { PROFILE_TYPES } from './types'
import { usernameSchema } from './username'

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

const optionalText = (maximum: number, message = `Keep this field to ${maximum} characters or fewer.`) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return undefined
      const normalized = value.trim()
      return normalized || undefined
    },
    z.string().max(maximum, message).optional(),
  )

const sailingExperienceSchema = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return undefined
    if (typeof value === 'string' && value.trim() === '') return undefined
    return typeof value === 'string' ? Number(value) : value
  },
  z.number({ error: 'Enter sailing experience as a number of years.' })
    .finite('Enter sailing experience as a valid number of years.')
    .min(0, 'Sailing experience cannot be negative.')
    .max(70, 'Enter sailing experience between 0 and 70 years.')
    .optional(),
)

const discardIrrelevantMaritimeValues = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const source = value as Record<string, unknown>
  if (source.profileType === 'seafarer' || source.profileType === 'maritime_professional') return source

  return {
    ...source,
    rank: undefined,
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
    fullName: z.string().trim().min(2, 'Add your full name.').max(120, 'Keep your full name to 120 characters or fewer.'),
    slug: usernameSchema,
    location: optionalText(120, 'Keep your location to 120 characters or fewer.'),
    headline: z.string().trim().min(4, 'Add a professional headline.').max(160, 'Keep your professional headline to 160 characters or fewer.'),
    summary: z.string().trim().min(20, 'Write at least 20 characters describing your professional background.').max(2000, 'Keep your professional summary to 2,000 characters or fewer.'),
    contactVisibility: z.enum(['private', 'members', 'public'], { error: 'Choose who can see your contact details.' }),
    skills: termsSchema,
    rank: optionalText(100, 'Keep your rank to 100 characters or fewer.'),
    currentCompany: optionalText(160, 'Keep the company or organisation name to 160 characters or fewer.'),
    currentVessel: optionalText(160, 'Keep the vessel name to 160 characters or fewer.'),
    sailingExperienceYears: sailingExperienceSchema,
    vesselTypes: termsSchema,
    tradingAreas: termsSchema,
    shoreCareerPreference: z.preprocess(
      (value) => value === true || value === 'true' || value === 'on',
      z.boolean(),
    ),
    availability: optionalText(100, 'Keep availability details to 100 characters or fewer.'),
  })
  .superRefine((data, context) => {
    if (data.profileType === 'seafarer' && (!data.rank || data.rank.length < 2)) {
      context.addIssue({ code: 'custom', path: ['rank'], message: 'Add your current or most recent rank.' })
    }
  })

export const onboardingSchema = z.preprocess(discardIrrelevantMaritimeValues, onboardingFieldsSchema)

export type OnboardingInput = z.infer<typeof onboardingSchema>

const profileIntentsSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string' || value.trim() === '') return []
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  },
  z.array(
    z.enum(PROFILE_INTENTS, { error: 'Choose a valid Sea N Shore activity.' }),
  )
    .min(1, 'Choose at least one thing you want to do on Sea N Shore.')
    .max(PROFILE_INTENTS.length, 'Choose only the available Sea N Shore activities.'),
).transform((values) => [...new Set(values)])

const activationFieldsSchema = z.object({
  persona: z.enum(PERSONAS, { error: 'Choose the option that best describes you.' }),
  profileIntents: profileIntentsSchema,
  fullName: z.string().trim()
    .min(2, 'Add your name.')
    .max(160, 'Keep your name to 160 characters or fewer.'),
  slug: usernameSchema,
  location: optionalText(120, 'Keep your location to 120 characters or fewer.'),
  currentCompany: optionalText(160, 'Keep the company or organisation name to 160 characters or fewer.'),
  rank: optionalText(100, 'Keep your rank to 100 characters or fewer.'),
  headline: optionalText(160, 'Keep your professional headline to 160 characters or fewer.'),
  specialization: optionalText(500, 'Keep your specialization to 500 characters or fewer.'),
  institutionName: optionalText(160, 'Keep your institution name to 160 characters or fewer.'),
  familyRelationship: optionalText(80, 'Keep your relationship to 80 characters or fewer.'),
  contactVisibility: z.enum(['private', 'members', 'public'], { error: 'Choose who can see your contact details.' }).default('members'),
})

function discardIrrelevantPersonaValues(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const source = value as Record<string, unknown>
  const persona = PERSONAS.find((entry) => entry === source.persona)
  if (!persona) return source

  return {
    ...source,
    rank: persona === 'seafarer' ? source.rank : undefined,
    currentCompany: personaUsesProfessionalCompany(persona) ? source.currentCompany : undefined,
    specialization: persona === 'trainer_instructor' ? source.specialization : undefined,
    institutionName: persona === 'student_cadet' ? source.institutionName : undefined,
    familyRelationship: persona === 'seafarer_family' ? source.familyRelationship : undefined,
  }
}

export const onboardingActivationSchema = z.preprocess(
  discardIrrelevantPersonaValues,
  activationFieldsSchema
    .superRefine((data, context) => {
      if (data.persona === 'seafarer' && (!data.rank || data.rank.length < 2)) {
        context.addIssue({
          code: 'custom',
          path: ['rank'],
          message: 'Add your current or most recent rank.',
        })
      }
    })
    .transform((data) => ({
      ...data,
      headline: defaultHeadlineForPersona(data),
    })),
)

export type OnboardingActivationInput = z.infer<typeof onboardingActivationSchema>
