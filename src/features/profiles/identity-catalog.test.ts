import { describe, expect, it } from 'vitest'
import {
  organisationIdentities,
  professionalIdentities,
  findIdentityOption,
  legacyProfileTypeForIdentity,
  searchIdentityOptions,
} from './identity-catalog'

describe('dynamic maritime identity catalog', () => {
  it('contains the exact demo catalog without collapsing identities', () => {
    expect(professionalIdentities).toHaveLength(191)
    expect(organisationIdentities).toHaveLength(115)

    expect(findIdentityOption('professional', 'Chief Engineer')).toMatchObject({
      label: 'Chief Engineer',
      family: 'Sea-going · Engine',
    })
    expect(findIdentityOption('professional', 'Maritime Lawyer')).toMatchObject({
      label: 'Maritime Lawyer',
      family: 'Legal, Insurance & Finance',
    })
    expect(findIdentityOption('organisation', 'Classification Society')).toMatchObject({
      label: 'Classification Society',
      family: 'Classification & Government',
    })
  })

  it('searches exact identities case-insensitively and by family', () => {
    expect(searchIdentityOptions('professional', 'chief eng')[0]?.label).toBe('Chief Engineer')
    expect(searchIdentityOptions('professional', 'legal maritime').map((item) => item.label)).toContain('Maritime Lawyer')
    expect(searchIdentityOptions('organisation', 'terminal').map((item) => item.label)).toContain('Container Terminal')
  })

  it('keeps the legacy broad profile type only as a compatibility projection', () => {
    expect(legacyProfileTypeForIdentity('organisation', 'Shipowner', 'Shipping & Ship Management')).toBe('company')
    expect(legacyProfileTypeForIdentity('professional', 'Chief Engineer', 'Sea-going · Engine')).toBe('seafarer')
    expect(legacyProfileTypeForIdentity('professional', 'Mentor', 'Professional Capacities')).toBe('mentor')
    expect(legacyProfileTypeForIdentity('professional', 'Maritime Recruiter', 'Recruitment, Welfare & Public Sector')).toBe('recruiter')
    expect(legacyProfileTypeForIdentity('professional', 'Maritime Lawyer', 'Legal, Insurance & Finance')).toBe('maritime_professional')
  })
})
