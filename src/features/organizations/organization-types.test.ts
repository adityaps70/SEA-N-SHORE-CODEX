import { describe, expect, it } from 'vitest'
import {
  ORGANIZATION_TYPE_CODES,
  displayOrganizationType,
  legacyOrganizationTypeCode,
  organizationTypeGroups,
  organizationVerificationChecks,
  resolveOrganizationType,
} from './organization-types'
import {
  organizationApplicationSchema,
  organizationDetailsFromInput,
  organizationTypeStoredLabel,
  parseOrganizationDetails,
} from './schemas'
import type { OrganizationApplicationInput } from './types'

function input(overrides: Partial<OrganizationApplicationInput> = {}): OrganizationApplicationInput {
  return {
    organizationName: 'Harbour Minds',
    organizationType: 'mental_health_provider',
    website: null,
    officialEmail: 'care@harbourminds.org',
    officeLocation: 'Manila, Philippines',
    description: 'Confidential counselling for seafarers and their families.',
    fleetSummary: null,
    vesselTypes: [],
    applicantRole: 'Clinical Lead',
    registrationReference: null,
    supportingNotes: null,
    servicesOffered: ['counselling'],
    languages: ['English', 'Tagalog'],
    helpline24x7: true,
    accreditation: 'PRC registered psychologists',
    ...overrides,
  }
}

function fieldErrors(value: unknown) {
  const result = organizationApplicationSchema.safeParse(value)
  if (result.success) return {}
  return result.error.flatten().fieldErrors as Record<string, string[]>
}

describe('organization type catalogue', () => {
  it('groups every type exactly once, across maritime and non-maritime sectors', () => {
    const groups = organizationTypeGroups()
    expect(groups.map((group) => group.label)).toEqual([
      'Shipping & maritime',
      'Wellbeing & support',
      'Education & training',
      'Public sector & associations',
      'Technology & other',
    ])
    const listed = groups.flatMap((group) => group.types.map((type) => type.code))
    expect(listed.sort()).toEqual([...ORGANIZATION_TYPE_CODES].sort())
    expect(groups.find((group) => group.id === 'wellbeing')?.types.map((type) => type.code)).toEqual([
      'mental_health_provider',
      'seafarer_welfare_charity',
      'counselling_service',
      'chaplaincy_mission',
    ])
  })

  it('shows verification requirements specific to each type on top of the shared checks', () => {
    expect(organizationVerificationChecks('manning_agency')).toEqual(expect.arrayContaining([
      "A work email address on your organization's own domain",
      'Valid RPSL licence (India) or MLC 2006 recruitment and placement certificate',
    ]))
    expect(organizationVerificationChecks('mental_health_provider').join(' ')).toMatch(/accreditation/i)
    expect(organizationVerificationChecks('regulator_government')).toContain('An official government email address')
  })
})

describe('existing organization type values', () => {
  it.each([
    ['Ship Management Company', 'ship_manager'],
    ['Crewing Company', 'manning_agency'],
    ['Manning agency (RPSL)', 'manning_agency'],
    ['Shipowner', 'shipowner'],
    ['Port operator', 'port_terminal'],
    ['Maritime Training Institute', 'maritime_training_institute'],
    ['P&I Club', 'pi_insurance'],
    ['Seafarers mental health charity', 'mental_health_provider'],
    ['Welfare NGO', 'seafarer_welfare_charity'],
    ['Stella Maris port chaplaincy', 'chaplaincy_mission'],
    ['Maritime Commission', 'regulator_government'],
    ['Seafarers Union', 'union'],
    ['Maritime software', 'maritime_tech'],
  ])('maps "%s" to %s', (label, code) => {
    expect(legacyOrganizationTypeCode(label)).toBe(code)
  })

  it('keeps unrecognised labels as "Other" with the original wording', () => {
    expect(resolveOrganizationType(null, 'Seafarer family network')).toEqual({ code: 'other', otherLabel: 'Seafarer family network' })
    expect(resolveOrganizationType(null, null)).toEqual({ code: 'other', otherLabel: null })
    expect(displayOrganizationType(null, 'Seafarer family network')).toBe('Seafarer family network')
  })

  it('prefers the stored type code over the free-text label', () => {
    expect(resolveOrganizationType('counselling_service', 'Ship manager')).toEqual({ code: 'counselling_service', otherLabel: null })
    expect(displayOrganizationType('counselling_service', 'anything')).toBe('Counselling service')
    expect(displayOrganizationType('other', 'Family network')).toBe('Family network')
  })

  it('accepts an older free-text type on submission and maps it', () => {
    const parsed = organizationApplicationSchema.parse(input({
      organizationType: 'Ship Management Company',
      servicesOffered: [],
      languages: [],
      helpline24x7: null,
      accreditation: null,
      fleetSummary: '12 tankers',
    }))
    expect(parsed.organizationType).toBe('ship_manager')
    expect(organizationTypeStoredLabel(parsed)).toBe('Ship manager')

    const other = organizationApplicationSchema.parse(input({ organizationType: 'Seafarer family network' }))
    expect(other.organizationType).toBe('other')
    expect(other.organizationTypeOther).toBe('Seafarer family network')
    expect(organizationTypeStoredLabel(other)).toBe('Seafarer family network')
  })
})

describe('type-dependent validation', () => {
  it('requires the recruitment licence for manning agencies only', () => {
    expect(fieldErrors(input({ organizationType: 'manning_agency', recruitmentLicence: null })).recruitmentLicence?.[0]).toMatch(/RPSL licence/)
    expect(fieldErrors(input({ organizationType: 'manning_agency', recruitmentLicence: 'RPSL-MUM-123' })).recruitmentLicence).toBeUndefined()
    expect(fieldErrors(input({ organizationType: 'shipowner', recruitmentLicence: null })).recruitmentLicence).toBeUndefined()
  })

  it('requires services, languages, a helpline answer and accreditation from mental-health providers', () => {
    const errors = fieldErrors(input({ servicesOffered: [], languages: [], helpline24x7: null, accreditation: null }))
    expect(Object.keys(errors).sort()).toEqual(['accreditation', 'helpline24x7', 'languages', 'servicesOffered'])
  })

  it('only asks welfare charities for services and the helpline answer', () => {
    const errors = fieldErrors(input({ organizationType: 'seafarer_welfare_charity', languages: [], accreditation: null, helpline24x7: null }))
    expect(Object.keys(errors)).toEqual(['helpline24x7'])
  })

  it('rejects unknown wellbeing services and invalid fleet sizes', () => {
    expect(fieldErrors(input({ servicesOffered: ['astrology'] })).servicesOffered?.[0]).toBe('Choose services from the list.')
    expect(fieldErrors(input({ organizationType: 'shipowner', fleetSize: 3.5 })).fleetSize?.[0]).toMatch(/whole number/)
    expect(fieldErrors(input({ organizationType: 'shipowner', fleetSize: Number.NaN })).fleetSize?.[0]).toMatch(/whole number/)
  })

  it('requires a type and a description when the type is Other', () => {
    expect(fieldErrors(input({ organizationType: '' })).organizationType?.[0]).toBe('Choose the type that best describes your organization.')
    expect(fieldErrors(input({ organizationType: 'other', organizationTypeOther: null })).organizationTypeOther?.[0]).toMatch(/Describe your organization type/)
  })

  it('drops fields that do not apply to the chosen type', () => {
    const parsed = organizationApplicationSchema.parse(input({
      fleetSize: 40,
      fleetSummary: 'Should not be kept',
      vesselTypes: ['Tanker'],
      recruitmentLicence: 'RPSL-1',
    }))
    expect(parsed).toMatchObject({
      fleetSize: null,
      fleetSummary: null,
      vesselTypes: [],
      recruitmentLicence: null,
      servicesOffered: ['counselling'],
      helpline24x7: true,
    })
    expect(organizationDetailsFromInput(parsed)).toEqual({
      servicesOffered: ['counselling'],
      languages: ['English', 'Tagalog'],
      helpline24x7: true,
      accreditation: 'PRC registered psychologists',
    })

    const shipping = organizationApplicationSchema.parse(input({
      organizationType: 'shipowner',
      fleetSize: '1,200' as unknown as number,
      vesselTypes: ['Bulk Carrier'],
    }))
    expect(shipping).toMatchObject({ fleetSize: 1200, vesselTypes: ['Bulk Carrier'], servicesOffered: [], languages: [], helpline24x7: null, accreditation: null })
  })

  it('reads stored details defensively', () => {
    expect(parseOrganizationDetails(null)).toEqual({})
    expect(parseOrganizationDetails({ fleetSize: '12', languages: ['English', 3], helpline24x7: true })).toEqual({ languages: ['English'], helpline24x7: true })
  })
})
