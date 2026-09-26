/**
 * Organization types supported by Sea N Shore.
 *
 * Sea N Shore serves far more than ship operators: wellbeing providers, welfare
 * charities, training bodies, regulators and unions all run workspaces. Each
 * type declares which extra fields apply to it, which of those are required,
 * and what Sea N Shore checks before the organization is verified.
 *
 * The canonical type code is stored in `companies.organization_type` and its
 * label in `companies.company_type` (free text used by search and older
 * screens). Organizations created before the code column existed only have the
 * free-text label; `resolveOrganizationType` maps those values on read.
 */

export const ORGANIZATION_TYPE_GROUPS = [
  { id: 'maritime', label: 'Shipping & maritime' },
  { id: 'wellbeing', label: 'Wellbeing & support' },
  { id: 'education', label: 'Education & training' },
  { id: 'public', label: 'Public sector & associations' },
  { id: 'other', label: 'Technology & other' },
] as const

export type OrganizationTypeGroup = (typeof ORGANIZATION_TYPE_GROUPS)[number]['id']

/** Optional, type-specific fields. Core fields (name, email, location…) apply to every type. */
export type OrganizationTypeField =
  | 'fleetSize'
  | 'vesselTypes'
  | 'fleetSummary'
  | 'recruitmentLicence'
  | 'servicesOffered'
  | 'languages'
  | 'helpline24x7'
  | 'accreditation'

type OrganizationTypeDefinition = {
  label: string
  group: OrganizationTypeGroup
  /** Short explanation shown under the type picker. */
  hint: string
  fields: readonly OrganizationTypeField[]
  required?: readonly OrganizationTypeField[]
  /** Extra checks on top of the checks every organization goes through. */
  verification: readonly string[]
  registrationLabel?: string
  registrationPlaceholder?: string
  accreditationLabel?: string
  accreditationPlaceholder?: string
  descriptionPlaceholder?: string
  applicantRolePlaceholder?: string
}

const FLEET_FIELDS = ['fleetSize', 'vesselTypes', 'fleetSummary'] as const
const WELLBEING_FIELDS = ['servicesOffered', 'languages', 'helpline24x7', 'accreditation'] as const

const TYPES = {
  shipowner: {
    label: 'Shipowner / ship operator',
    group: 'maritime',
    hint: 'Owns or commercially operates vessels.',
    fields: FLEET_FIELDS,
    verification: ['Company registration number or IMO company number'],
    registrationLabel: 'Company registration or IMO company number',
    registrationPlaceholder: 'CIN, company number or IMO company number',
    descriptionPlaceholder: 'Your fleet, trading areas and the crew or shore roles you hire for.',
  },
  ship_manager: {
    label: 'Ship manager',
    group: 'maritime',
    hint: 'Technical, crew or commercial management for owners.',
    fields: FLEET_FIELDS,
    verification: ['Company registration number or IMO company number', 'Document of Compliance (DOC) holder details if you are the ISM manager'],
    registrationLabel: 'Company registration or IMO company number',
    registrationPlaceholder: 'CIN, company number or IMO company number',
    descriptionPlaceholder: 'Vessels under management, services you provide and the roles you hire for.',
  },
  manning_agency: {
    label: 'Manning / crewing agency',
    group: 'maritime',
    hint: 'Recruits and places seafarers on board.',
    fields: ['recruitmentLicence', 'vesselTypes', 'fleetSummary'],
    required: ['recruitmentLicence'],
    verification: ['Valid RPSL licence (India) or MLC 2006 recruitment and placement certificate'],
    registrationLabel: 'Company registration number',
    registrationPlaceholder: 'CIN or company number',
    descriptionPlaceholder: 'Principals you crew for, ranks you place and where you recruit.',
    applicantRolePlaceholder: 'Director, Crewing Manager, Manning Superintendent',
  },
  port_terminal: {
    label: 'Port or terminal operator',
    group: 'maritime',
    hint: 'Ports, terminals, harbour and pilotage services.',
    fields: ['fleetSummary'],
    verification: ['Port authority or company registration number'],
    registrationLabel: 'Port authority or company registration number',
  },
  classification_society: {
    label: 'Classification society',
    group: 'maritime',
    hint: 'Class, survey and statutory certification.',
    fields: ['fleetSummary', 'accreditation'],
    verification: ['IACS membership or recognised organization (RO) authorisation'],
    accreditationLabel: 'IACS membership or RO authorisation',
    accreditationPlaceholder: 'IACS member, or flag states that authorise you',
  },
  maritime_training_institute: {
    label: 'Maritime training institute',
    group: 'maritime',
    hint: 'STCW courses, pre-sea and post-sea training.',
    fields: ['accreditation'],
    required: ['accreditation'],
    verification: ['Flag-state or maritime administration approval for the courses you run (for example DG Shipping MTI approval)'],
    accreditationLabel: 'Course approval / accreditation',
    accreditationPlaceholder: 'DG Shipping MTI number, MCA or other administration approval',
    descriptionPlaceholder: 'Courses you run, campuses and who they are for.',
    applicantRolePlaceholder: 'Principal, Course Director, Admissions Head',
  },
  maritime_law_firm: {
    label: 'Maritime law firm',
    group: 'maritime',
    hint: 'Shipping, admiralty and seafarer legal services.',
    fields: [],
    verification: ['Bar council or law society registration of the firm'],
    registrationLabel: 'Bar council / law society registration',
  },
  pi_insurance: {
    label: 'P&I club / marine insurance',
    group: 'maritime',
    hint: 'Protection & indemnity, hull and cargo cover.',
    fields: ['fleetSummary'],
    verification: ['Insurance licence number or International Group membership'],
    registrationLabel: 'Insurance licence or registration number',
  },
  marine_services: {
    label: 'Marine services & suppliers',
    group: 'maritime',
    hint: 'Ship chandlers, agents, repairs, equipment and logistics.',
    fields: ['vesselTypes', 'fleetSummary'],
    verification: ['Company registration number'],
  },
  offshore_energy: {
    label: 'Offshore & energy',
    group: 'maritime',
    hint: 'Offshore support, oil & gas, wind and energy operators.',
    fields: FLEET_FIELDS,
    verification: ['Company registration number'],
  },
  shipyard: {
    label: 'Shipyard / ship repair',
    group: 'maritime',
    hint: 'Shipbuilding, dry docking and repair.',
    fields: ['vesselTypes', 'fleetSummary'],
    verification: ['Company registration number'],
  },
  mental_health_provider: {
    label: 'Mental-health & wellbeing provider',
    group: 'wellbeing',
    hint: 'Clinical, psychological or wellbeing support for seafarers and families.',
    fields: WELLBEING_FIELDS,
    required: ['servicesOffered', 'languages', 'helpline24x7', 'accreditation'],
    verification: [
      'Professional accreditation or registration of the service or its clinicians',
      'A safeguarding and confidentiality policy, which Sea N Shore may ask to see',
    ],
    accreditationLabel: 'Professional accreditation or registration',
    accreditationPlaceholder: 'For example BACP, UKCP, APA, RCI or a national health registration',
    descriptionPlaceholder: 'Who you support, how people reach you and what happens after they get in touch.',
    applicantRolePlaceholder: 'Clinical Lead, Service Manager, Founder',
  },
  seafarer_welfare_charity: {
    label: 'Seafarer welfare charity / NGO',
    group: 'wellbeing',
    hint: 'Welfare, hardship and advocacy for seafarers and families.',
    fields: WELLBEING_FIELDS,
    required: ['servicesOffered', 'helpline24x7'],
    verification: ['Charity or NGO registration number'],
    registrationLabel: 'Charity or NGO registration number',
    accreditationLabel: 'Accreditation or affiliations',
    accreditationPlaceholder: 'Networks or bodies you are part of (optional)',
  },
  counselling_service: {
    label: 'Counselling service',
    group: 'wellbeing',
    hint: 'Individual, family or group counselling.',
    fields: WELLBEING_FIELDS,
    required: ['servicesOffered', 'languages', 'helpline24x7', 'accreditation'],
    verification: [
      'Professional accreditation or registration of your counsellors',
      'A safeguarding and confidentiality policy, which Sea N Shore may ask to see',
    ],
    accreditationLabel: 'Professional accreditation or registration',
    accreditationPlaceholder: 'For example BACP, UKCP, ACA or a national counselling register',
    applicantRolePlaceholder: 'Lead Counsellor, Service Manager, Founder',
  },
  chaplaincy_mission: {
    label: "Chaplaincy / seafarers' mission",
    group: 'wellbeing',
    hint: 'Port chaplaincy, ship visits and seafarer centres.',
    fields: WELLBEING_FIELDS,
    required: ['servicesOffered', 'helpline24x7'],
    verification: ['Affiliation or charity registration of the mission'],
    registrationLabel: 'Charity registration or affiliation',
    accreditationLabel: 'Affiliation',
    accreditationPlaceholder: 'The network or church body you belong to (optional)',
  },
  university_college: {
    label: 'University or college',
    group: 'education',
    hint: 'Degree, diploma and research programmes.',
    fields: ['accreditation'],
    verification: ['Recognition or accreditation of the institution'],
    accreditationLabel: 'Recognition / accreditation',
    accreditationPlaceholder: 'The body that recognises your institution (optional)',
  },
  training_provider: {
    label: 'Training provider',
    group: 'education',
    hint: 'Short courses, professional and soft-skill training.',
    fields: ['accreditation'],
    verification: ['Company registration number; course approvals if you issue certificates'],
    accreditationLabel: 'Course approvals or accreditation',
    accreditationPlaceholder: 'Approvals for the certificates you issue (optional)',
  },
  regulator_government: {
    label: 'Regulator / government body',
    group: 'public',
    hint: 'Maritime administrations, flag states and public agencies.',
    fields: [],
    verification: ['An official government email address'],
    registrationLabel: 'Department or reference number',
    registrationPlaceholder: 'Optional',
  },
  union: {
    label: 'Trade union',
    group: 'public',
    hint: 'Seafarer and maritime worker unions.',
    fields: [],
    verification: ['Union registration or federation affiliation number'],
    registrationLabel: 'Union registration number',
  },
  professional_association: {
    label: 'Professional association',
    group: 'public',
    hint: 'Institutes, federations and industry bodies.',
    fields: [],
    verification: ['Registration number of the association'],
  },
  maritime_tech: {
    label: 'Maritime technology',
    group: 'other',
    hint: 'Software, connectivity and digital products for shipping.',
    fields: [],
    verification: ['Company registration number'],
  },
  consultancy: {
    label: 'Consultancy',
    group: 'other',
    hint: 'Advisory, audit, vetting and compliance services.',
    fields: [],
    verification: ['Company registration number'],
  },
  recruitment_agency: {
    label: 'Recruitment agency (shore roles)',
    group: 'other',
    hint: 'Recruitment for shore-based and office roles.',
    fields: ['recruitmentLicence'],
    verification: ['Company registration number; recruitment licence where your country requires one'],
    applicantRolePlaceholder: 'Director, Talent Acquisition Lead',
  },
  other: {
    label: 'Other',
    group: 'other',
    hint: 'Describe your organization type in your own words.',
    fields: [],
    verification: ['Company or charity registration number, if you have one'],
  },
} as const satisfies Record<string, OrganizationTypeDefinition>

export type OrganizationTypeCode = keyof typeof TYPES

export const ORGANIZATION_TYPE_CODES = Object.keys(TYPES) as OrganizationTypeCode[]

export const WELLBEING_SERVICES = [
  { value: 'counselling', label: 'Counselling & therapy' },
  { value: 'crisis_support', label: 'Crisis support' },
  { value: 'peer_support', label: 'Peer support' },
  { value: 'helpline', label: 'Helpline or chat line' },
  { value: 'family_support', label: 'Support for families' },
  { value: 'welfare_visits', label: 'Port & ship welfare visits' },
  { value: 'wellbeing_training', label: 'Mental-health & wellbeing training' },
  { value: 'financial_legal', label: 'Financial or legal advice' },
  { value: 'spiritual_care', label: 'Spiritual & pastoral care' },
  { value: 'online_sessions', label: 'Online / telehealth sessions' },
] as const

export type WellbeingService = (typeof WELLBEING_SERVICES)[number]['value']
export const WELLBEING_SERVICE_VALUES = WELLBEING_SERVICES.map((service) => service.value) as WellbeingService[]

/** Checks applied to every organization, whatever its type. */
export const BASE_VERIFICATION_CHECKS = [
  "A work email address on your organization's own domain",
  'Your role and authority to represent the organization',
] as const

export type OrganizationTypeConfig = OrganizationTypeDefinition & { code: OrganizationTypeCode }

export function isOrganizationTypeCode(value: unknown): value is OrganizationTypeCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TYPES, value)
}

export function getOrganizationType(code: OrganizationTypeCode): OrganizationTypeConfig {
  return { code, ...(TYPES[code] as OrganizationTypeDefinition) }
}

export function organizationTypeLabel(code: OrganizationTypeCode) {
  return TYPES[code].label
}

export function organizationTypeGroups() {
  return ORGANIZATION_TYPE_GROUPS.map((group) => ({
    ...group,
    types: ORGANIZATION_TYPE_CODES.filter((code) => TYPES[code].group === group.id).map(getOrganizationType),
  }))
}

export function organizationTypeHasField(code: OrganizationTypeCode, field: OrganizationTypeField) {
  return (TYPES[code].fields as readonly OrganizationTypeField[]).includes(field)
}

export function organizationTypeRequiresField(code: OrganizationTypeCode, field: OrganizationTypeField) {
  const definition = TYPES[code] as OrganizationTypeDefinition
  return Boolean(definition.required?.includes(field))
}

export function organizationVerificationChecks(code: OrganizationTypeCode) {
  return [...BASE_VERIFICATION_CHECKS, ...TYPES[code].verification]
}

export function isWellbeingType(code: OrganizationTypeCode) {
  return TYPES[code].group === 'wellbeing'
}

/**
 * Ordered keyword rules for organizations saved before type codes existed.
 * More specific phrases come first ("port operator" must not become a shipowner).
 */
const LEGACY_TYPE_RULES: ReadonlyArray<[RegExp, OrganizationTypeCode]> = [
  [/manning|crewing|crew (management|agency|agent|services)|\brpsl\b/, 'manning_agency'],
  [/ship ?manag|technical manag/, 'ship_manager'],
  [/mental|wellbeing|well-being|psycholog|psychiatr|therap/, 'mental_health_provider'],
  [/counsel/, 'counselling_service'],
  [/chaplain|\bmissions?\b|stella maris|apostleship/, 'chaplaincy_mission'],
  [/charity|\bngo\b|welfare|non-?profit|foundation/, 'seafarer_welfare_charity'],
  [/\bport\b|terminal|harbou?r|pilotage/, 'port_terminal'],
  [/classification|class society/, 'classification_society'],
  [/maritime (training|academy|institute|college|school)|nautical (college|academy|school)|\bmti\b|seafarer training/, 'maritime_training_institute'],
  [/\blaw\b|legal|solicitor|advocate|attorney/, 'maritime_law_firm'],
  [/p ?& ?i|p and i|insur|underwrit/, 'pi_insurance'],
  [/shipyard|ship ?repair|dry ?dock|shipbuild/, 'shipyard'],
  [/offshore|energy|oil (and|&) gas|\bwind\b/, 'offshore_energy'],
  [/university|college/, 'university_college'],
  [/training|academy|institute|school|education|e-?learning/, 'training_provider'],
  [/regulat|government|ministry|directorate|commission|flag state|maritime administration|coast ?guard/, 'regulator_government'],
  [/\bunion\b/, 'union'],
  [/association|federation|chamber|guild|society/, 'professional_association'],
  [/tech|software|digital|saas|\bit\b|platform/, 'maritime_tech'],
  [/consult|advis/, 'consultancy'],
  [/recruit|staffing|placement|\bhr\b/, 'recruitment_agency'],
  [/ship ?owner|\bowner\b|operator|shipping|shipowning|tanker|bulk|container line/, 'shipowner'],
  [/supplier|chandl|agency|agent|logistics|services|marine/, 'marine_services'],
]

export function legacyOrganizationTypeCode(value: string | null | undefined): OrganizationTypeCode | null {
  const normalized = value?.trim().toLocaleLowerCase('en') ?? ''
  if (!normalized) return null
  if (isOrganizationTypeCode(normalized)) return normalized
  for (const [pattern, code] of LEGACY_TYPE_RULES) {
    if (pattern.test(normalized)) return code
  }
  return null
}

/**
 * Resolve the type of a stored organization. Newer rows carry a code; older ones
 * only a free-text label, which is mapped by keyword. Anything unrecognised
 * becomes "Other" and keeps its original wording as the description.
 */
export function resolveOrganizationType(
  storedCode: string | null | undefined,
  label: string | null | undefined,
): { code: OrganizationTypeCode; otherLabel: string | null } {
  if (isOrganizationTypeCode(storedCode)) {
    return { code: storedCode, otherLabel: storedCode === 'other' ? label?.trim() || null : null }
  }
  const mapped = legacyOrganizationTypeCode(label)
  if (mapped && mapped !== 'other') return { code: mapped, otherLabel: null }
  return { code: 'other', otherLabel: label?.trim() || null }
}

/** Human label for any stored organization, falling back gracefully for older rows. */
export function displayOrganizationType(storedCode: string | null | undefined, label: string | null | undefined) {
  if (isOrganizationTypeCode(storedCode) && storedCode !== 'other') return organizationTypeLabel(storedCode)
  const trimmed = label?.trim()
  if (trimmed) return trimmed
  return 'Organization'
}

export function wellbeingServiceLabel(value: string) {
  return WELLBEING_SERVICES.find((service) => service.value === value)?.label ?? value
}
