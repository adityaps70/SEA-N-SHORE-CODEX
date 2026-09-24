import { z } from 'zod'

const optionalText = (maximum: number) => z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  z.string().max(maximum, `Keep this field to ${maximum} characters or fewer.`).nullable(),
)

const optionalUrl = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    return normalized || null
  },
  z.string().url('Enter a complete website address, for example https://company.com.').max(320, 'Keep the website address to 320 characters or fewer.').nullable(),
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
  z.array(z.string().min(1).max(120, 'Keep each vessel type to 120 characters or fewer.')).max(30, 'Add no more than 30 vessel types.'),
)

export const organizationApplicationSchema = z.object({
  organizationName: z.string().trim()
    .min(2, 'Enter the organization name using at least 2 characters.')
    .max(160, 'Keep the organization name to 160 characters or fewer.'),
  organizationType: z.string().trim()
    .min(2, 'Enter the organization type, for example Shipowner or Ship Manager.')
    .max(160, 'Keep the organization type to 160 characters or fewer.'),
  website: optionalUrl,
  officialEmail: z.string().trim().toLowerCase()
    .email('Enter a valid work email address, for example name@company.com.')
    .max(320, 'Keep the work email address to 320 characters or fewer.'),
  officeLocation: z.string().trim()
    .min(2, 'Enter the organization office location.')
    .max(240, 'Keep the office location to 240 characters or fewer.'),
  description: z.string().trim()
    .min(20, 'Add at least 20 characters describing the organization and its maritime work.')
    .max(4000, 'Keep the organization description to 4,000 characters or fewer.'),
  fleetSummary: optionalText(2000),
  vesselTypes: vesselTypesSchema,
  applicantRole: z.string().trim()
    .min(2, 'Enter your role or relationship with the organization.')
    .max(160, 'Keep your role to 160 characters or fewer.'),
  registrationReference: optionalText(160),
  supportingNotes: optionalText(4000),
})

export type ParsedOrganizationApplicationInput = z.infer<typeof organizationApplicationSchema>
