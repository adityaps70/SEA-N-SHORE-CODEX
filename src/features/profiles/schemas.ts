import { z } from 'zod'
import { findIdentityOption, IDENTITY_ROOTS } from './identity-catalog'
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

const secondaryIdentitySchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string' || value.trim() === '') return []
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed
    } catch {
      return value
    }
  },
  z.array(
    z.string().trim()
      .min(2, 'Each additional identity must have at least 2 characters.')
      .max(120, 'Keep each additional identity to 120 characters or fewer.'),
  ).max(10, 'Add no more than 10 additional identities.'),
).transform((values) => {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.toLocaleLowerCase('en')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
})

const activationFieldsSchema = z.object({
  identityRoot: z.enum(IDENTITY_ROOTS, { error: 'Choose Professional or Organisation.' }),
  primaryIdentity: z.string().trim()
    .min(2, 'Choose your exact maritime identity.')
    .max(120, 'Keep your maritime identity to 120 characters or fewer.'),
  primaryIdentityFamily: z.string().trim()
    .min(2, 'Choose the category for your maritime identity.')
    .max(120, 'Keep the identity category to 120 characters or fewer.'),
  secondaryIdentities: secondaryIdentitySchema,
  fullName: z.string().trim()
    .min(2, 'Add your name.')
    .max(160, 'Keep your name to 160 characters or fewer.'),
  slug: usernameSchema,
  location: optionalText(120, 'Keep your location to 120 characters or fewer.'),
  currentCompany: optionalText(160, 'Keep the company or organisation name to 160 characters or fewer.'),
  headline: optionalText(160, 'Keep your professional headline to 160 characters or fewer.'),
  contactVisibility: z.enum(['private', 'members', 'public'], { error: 'Choose who can see your contact details.' }).default('members'),
})

export const onboardingActivationSchema = activationFieldsSchema
  .superRefine((data, context) => {
    if (data.primaryIdentityFamily === 'Custom identity') return
    const option = findIdentityOption(data.identityRoot, data.primaryIdentity)
    if (!option || option.family !== data.primaryIdentityFamily) {
      context.addIssue({
        code: 'custom',
        path: ['primaryIdentity'],
        message: 'Choose an identity from the maritime list or use a custom identity.',
      })
    }
  })
  .transform((data) => ({
    ...data,
    headline: data.headline ?? data.primaryIdentity,
  }))

export type OnboardingActivationInput = z.infer<typeof onboardingActivationSchema>
