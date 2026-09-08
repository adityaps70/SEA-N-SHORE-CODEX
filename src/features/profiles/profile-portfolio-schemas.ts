import { z } from 'zod'
import { profileExperienceTracks } from './profile-portfolio-types'

function nullableText(maximum: number) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined) return null
      if (typeof value !== 'string') return value
      const normalized = value.trim()
      return normalized || null
    },
    z.string().max(maximum).nullable(),
  )
}

const nullableDate = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null
    if (typeof value !== 'string') return value
    const normalized = value.trim()
    return normalized || null
  },
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.').nullable(),
)

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
  z.array(z.string().min(1).max(100)).max(30),
)

const currentSchema = z.preprocess(
  (value) => value === true || value === 'true' || value === 'on',
  z.boolean(),
)

const baseExperienceSchema = z.object({
  track: z.enum(profileExperienceTracks),
  title: z.string().trim().min(2, 'Add your rank or role.').max(160),
  organization: nullableText(180),
  vessel: nullableText(160),
  vesselType: nullableText(120),
  location: nullableText(160),
  startedOn: nullableDate,
  endedOn: nullableDate,
  isCurrent: currentSchema,
  description: nullableText(4000),
  cargoExperience: termsSchema,
  engineExperience: termsSchema,
  tradingAreas: termsSchema,
})

export const profileExperienceInputSchema = baseExperienceSchema
  .superRefine((data, context) => {
    if (data.startedOn && data.endedOn && data.endedOn < data.startedOn) {
      context.addIssue({ code: 'custom', path: ['endedOn'], message: 'End date cannot be before the start date.' })
    }

    if (data.track !== 'sea_service' && !data.organization) {
      context.addIssue({ code: 'custom', path: ['organization'], message: 'Add the organisation or company.' })
    }
  })
  .transform((data) => {
    if (data.track === 'sea_service') {
      return {
        ...data,
        endedOn: data.isCurrent ? null : data.endedOn,
      }
    }

    return {
      ...data,
      vessel: null,
      vesselType: null,
      endedOn: data.isCurrent ? null : data.endedOn,
      cargoExperience: [],
      engineExperience: [],
      tradingAreas: [],
    }
  })

export const profileExperienceIdSchema = z.string().uuid()

export type ProfileExperienceInput = z.infer<typeof profileExperienceInputSchema>
