import { z } from 'zod'
import {
  ORGANIZATION_TYPE_CODES,
  WELLBEING_SERVICE_VALUES,
  getOrganizationType,
  isOrganizationTypeCode,
  organizationTypeHasField,
  organizationTypeRequiresField,
  resolveOrganizationType,
  type OrganizationTypeCode,
  type OrganizationTypeField,
} from './organization-types'
import type { OrganizationDetails } from './types'

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

function uniqueList(value: unknown) {
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
}

const vesselTypesSchema = z.preprocess(
  uniqueList,
  z.array(z.string().min(1).max(120, 'Keep each vessel type to 120 characters or fewer.')).max(30, 'Add no more than 30 vessel types.'),
)

const languagesSchema = z.preprocess(
  uniqueList,
  z.array(z.string().min(2, 'Enter each language using at least 2 characters.').max(60, 'Keep each language to 60 characters or fewer.')).max(20, 'Add no more than 20 languages.'),
)

const servicesSchema = z.preprocess(
  uniqueList,
  z.array(z.enum(WELLBEING_SERVICE_VALUES as [string, ...string[]], { message: 'Choose services from the list.' })).max(WELLBEING_SERVICE_VALUES.length),
)

const fleetSizeSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null
    if (typeof value === 'number') return value
    if (typeof value !== 'string') return value
    const normalized = value.trim().replace(/,/g, '')
    if (!normalized) return null
    return Number(normalized)
  },
  z.number({ message: 'Enter the number of vessels as a whole number, for example 12.' })
    .int('Enter the number of vessels as a whole number, for example 12.')
    .min(0, 'The number of vessels cannot be negative.')
    .max(20000, 'Enter a number of vessels below 20,000.')
    .nullable(),
)

const helplineSchema = z.preprocess(
  (value) => {
    if (typeof value === 'boolean') return value
    if (value === 'yes') return true
    if (value === 'no') return false
    return null
  },
  z.boolean().nullable(),
)

/** Accept current type codes and older free-text labels ("Ship Management Company"). */
function normalizeOrganizationType(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = { ...(value as Record<string, unknown>) }
  const raw = typeof record.organizationType === 'string' ? record.organizationType.trim() : ''
  if (raw && !isOrganizationTypeCode(raw)) {
    const resolved = resolveOrganizationType(null, raw)
    record.organizationType = resolved.code
    const other = typeof record.organizationTypeOther === 'string' ? record.organizationTypeOther.trim() : ''
    if (resolved.code === 'other' && !other) record.organizationTypeOther = resolved.otherLabel
  }
  return record
}

const REQUIRED_MESSAGES: Record<OrganizationTypeField, string> = {
  fleetSize: 'Enter the number of vessels you own or manage.',
  vesselTypes: 'Add at least one vessel type.',
  fleetSummary: 'Add a short summary of your operations.',
  recruitmentLicence: 'Enter your RPSL licence or MLC recruitment and placement certificate number.',
  servicesOffered: 'Choose at least one service you offer.',
  languages: 'Add at least one language you support people in.',
  helpline24x7: 'Tell us whether you run a 24/7 helpline.',
  accreditation: 'Enter your accreditation or registration so Sea N Shore can verify the service.',
}

function isEmpty(value: unknown) {
  if (value === null || value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'string') return value.trim().length === 0
  return false
}

const baseApplicationSchema = z.object({
  organizationName: z.string().trim()
    .min(2, 'Enter the organization name using at least 2 characters.')
    .max(160, 'Keep the organization name to 160 characters or fewer.'),
  organizationType: z.enum(ORGANIZATION_TYPE_CODES as [OrganizationTypeCode, ...OrganizationTypeCode[]], {
    message: 'Choose the type that best describes your organization.',
  }),
  organizationTypeOther: optionalText(160),
  website: optionalUrl,
  officialEmail: z.string().trim().toLowerCase()
    .email('Enter a valid work email address, for example name@company.com.')
    .max(320, 'Keep the work email address to 320 characters or fewer.'),
  officeLocation: z.string().trim()
    .min(2, 'Enter the organization office location.')
    .max(240, 'Keep the office location to 240 characters or fewer.'),
  description: z.string().trim()
    .min(20, 'Add at least 20 characters describing the organization and what it does.')
    .max(4000, 'Keep the organization description to 4,000 characters or fewer.'),
  fleetSize: fleetSizeSchema,
  fleetSummary: optionalText(2000),
  vesselTypes: vesselTypesSchema,
  recruitmentLicence: optionalText(120),
  servicesOffered: servicesSchema,
  languages: languagesSchema,
  helpline24x7: helplineSchema,
  accreditation: optionalText(240),
  applicantRole: z.string().trim()
    .min(2, 'Enter your role or relationship with the organization.')
    .max(160, 'Keep your role to 160 characters or fewer.'),
  registrationReference: optionalText(160),
  supportingNotes: optionalText(4000),
})

const TYPE_FIELDS: OrganizationTypeField[] = [
  'fleetSize',
  'vesselTypes',
  'fleetSummary',
  'recruitmentLicence',
  'servicesOffered',
  'languages',
  'helpline24x7',
  'accreditation',
]

export const organizationApplicationSchema = z.preprocess(
  normalizeOrganizationType,
  baseApplicationSchema
    .superRefine((value, context) => {
      const code = value.organizationType
      if (code === 'other' && !value.organizationTypeOther) {
        context.addIssue({
          code: 'custom',
          path: ['organizationTypeOther'],
          message: 'Describe your organization type, for example "Seafarer family network".',
        })
      }
      for (const field of TYPE_FIELDS) {
        if (organizationTypeRequiresField(code, field) && isEmpty(value[field])) {
          context.addIssue({ code: 'custom', path: [field], message: REQUIRED_MESSAGES[field] })
        }
      }
    })
    // Fields that do not apply to the chosen type are dropped so a wellbeing
    // provider never ends up with a stale fleet summary, and vice versa.
    .transform((value) => {
      const code = value.organizationType
      const has = (field: OrganizationTypeField) => organizationTypeHasField(code, field)
      return {
        ...value,
        organizationTypeOther: code === 'other' ? value.organizationTypeOther : null,
        fleetSize: has('fleetSize') ? value.fleetSize : null,
        fleetSummary: has('fleetSummary') ? value.fleetSummary : null,
        vesselTypes: has('vesselTypes') ? value.vesselTypes : [],
        recruitmentLicence: has('recruitmentLicence') ? value.recruitmentLicence : null,
        servicesOffered: has('servicesOffered') ? value.servicesOffered : [],
        languages: has('languages') ? value.languages : [],
        helpline24x7: has('helpline24x7') ? value.helpline24x7 : null,
        accreditation: has('accreditation') ? value.accreditation : null,
      }
    }),
)

export type ParsedOrganizationApplicationInput = z.output<typeof organizationApplicationSchema>

/** Label stored in companies.company_type, used by search and older screens. */
export function organizationTypeStoredLabel(input: Pick<ParsedOrganizationApplicationInput, 'organizationType' | 'organizationTypeOther'>) {
  if (input.organizationType === 'other') return input.organizationTypeOther ?? getOrganizationType('other').label
  return getOrganizationType(input.organizationType).label
}

/** Type-specific details stored as JSON in companies.organization_details. */
export function organizationDetailsFromInput(input: ParsedOrganizationApplicationInput): OrganizationDetails {
  const details: OrganizationDetails = {}
  if (input.fleetSize !== null) details.fleetSize = input.fleetSize
  if (input.recruitmentLicence) details.recruitmentLicence = input.recruitmentLicence
  if (input.servicesOffered.length) details.servicesOffered = input.servicesOffered
  if (input.languages.length) details.languages = input.languages
  if (input.helpline24x7 !== null) details.helpline24x7 = input.helpline24x7
  if (input.accreditation) details.accreditation = input.accreditation
  return details
}

/** Read stored details defensively; the column is free-form JSON. */
export function parseOrganizationDetails(value: unknown): OrganizationDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const details: OrganizationDetails = {}
  if (typeof record.fleetSize === 'number' && Number.isFinite(record.fleetSize)) details.fleetSize = record.fleetSize
  if (typeof record.recruitmentLicence === 'string' && record.recruitmentLicence.trim()) details.recruitmentLicence = record.recruitmentLicence
  if (Array.isArray(record.servicesOffered)) details.servicesOffered = record.servicesOffered.filter((entry): entry is string => typeof entry === 'string')
  if (Array.isArray(record.languages)) details.languages = record.languages.filter((entry): entry is string => typeof entry === 'string')
  if (typeof record.helpline24x7 === 'boolean') details.helpline24x7 = record.helpline24x7
  if (typeof record.accreditation === 'string' && record.accreditation.trim()) details.accreditation = record.accreditation
  return details
}
