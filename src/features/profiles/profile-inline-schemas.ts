import { z } from 'zod'
import type { ProfileType } from './types'

function optionalText(maximum: number) {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return undefined
      const normalized = value.trim()
      return normalized || undefined
    },
    z.string().max(maximum).optional(),
  )
}

const termsSchema = z.preprocess(
  (value) => {
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
  },
  z.array(z.string().min(1).max(80)).max(20),
)

const sailingExperienceSchema = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) return undefined
    return typeof value === 'string' ? Number(value) : value
  },
  z.number().finite().min(0).max(70).optional(),
)

export const profileIdentitySectionSchema = z.object({
  fullName: z.string().trim().min(2, 'Add your full name.').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Choose a profile address.')
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letters, numbers, and single hyphens.'),
  location: optionalText(120),
  headline: z.string().trim().min(4, 'Add a professional headline.').max(160),
  currentCompany: optionalText(160),
  contactVisibility: z.enum(['private', 'members', 'public']),
})

export const profileAboutSectionSchema = z.object({
  summary: z.string().trim().min(20, 'Write at least 20 characters.').max(2000),
  skills: termsSchema,
})

export const profileProfessionalSectionSchema = z
  .object({
    profileType: z.custom<ProfileType>(),
    rank: optionalText(100),
    currentVessel: optionalText(160),
    sailingExperienceYears: sailingExperienceSchema,
    vesselTypes: termsSchema,
    tradingAreas: termsSchema,
    shoreCareerPreference: z.preprocess(
      (value) => value === true || value === 'true' || value === 'on',
      z.boolean(),
    ),
    availability: z.enum(['onboard', 'ashore']),
  })
  .superRefine((data, context) => {
    if (data.profileType === 'seafarer' && (!data.rank || data.rank.length < 2)) {
      context.addIssue({ code: 'custom', path: ['rank'], message: 'Add your current or most recent rank.' })
    }
  })

export type ProfileIdentitySectionInput = z.infer<typeof profileIdentitySectionSchema>
export type ProfileAboutSectionInput = z.infer<typeof profileAboutSectionSchema>
export type ProfileProfessionalSectionInput = z.infer<typeof profileProfessionalSectionSchema>
