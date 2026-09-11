import { z } from 'zod'

const optionalText = (maximum: number) => z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  z.string().max(maximum).nullable(),
)

const optionalUrl = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  z.string().url('Add a valid website URL.').max(320).nullable(),
)

const vesselTypesSchema = z.preprocess(
  (value) => {
    const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
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
  z.array(z.string().min(1).max(120)).max(30),
)

export const organizationApplicationSchema = z.object({
  organizationName: z.string().trim().min(2).max(160),
  organizationType: z.string().trim().min(2).max(160),
  website: optionalUrl,
  officialEmail: z.string().trim().toLowerCase().email().max(320),
  officeLocation: z.string().trim().min(2).max(240),
  description: z.string().trim().min(20).max(4000),
  fleetSummary: optionalText(2000),
  vesselTypes: vesselTypesSchema,
  applicantRole: z.string().trim().min(2).max(160),
  registrationReference: optionalText(160),
  supportingNotes: optionalText(4000),
})

export type ParsedOrganizationApplicationInput = z.infer<typeof organizationApplicationSchema>
