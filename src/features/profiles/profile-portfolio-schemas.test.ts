import { describe, expect, it } from 'vitest'
import { profileCredentialInputSchema, profileExperienceInputSchema } from './profile-portfolio-schemas'

describe('profileExperienceInputSchema', () => {
  it('normalizes a sea-service record with maritime specialist fields', () => {
    const parsed = profileExperienceInputSchema.parse({
      track: 'sea_service',
      title: 'Chief Engineer',
      organization: 'Oceanic Shipping',
      vessel: 'MT Horizon',
      vesselType: 'Oil Tanker',
      location: '',
      startedOn: '2023-01-10',
      endedOn: '',
      isCurrent: 'on',
      description: 'Chief Engineer onboard worldwide tanker operations.',
      cargoExperience: 'Crude Oil, Clean Petroleum Products, Crude Oil',
      engineExperience: 'MAN B&W, Sulzer',
      tradingAreas: 'Worldwide, Arabian Gulf',
    })

    expect(parsed.track).toBe('sea_service')
    expect(parsed.vessel).toBe('MT Horizon')
    expect(parsed.cargoExperience).toEqual(['Crude Oil', 'Clean Petroleum Products'])
    expect(parsed.engineExperience).toEqual(['MAN B&W', 'Sulzer'])
    expect(parsed.tradingAreas).toEqual(['Worldwide', 'Arabian Gulf'])
    expect(parsed.isCurrent).toBe(true)
    expect(parsed.endedOn).toBeNull()
  })

  it('drops sea-only fields from a shore role instead of treating one generic form as maritime truth', () => {
    const parsed = profileExperienceInputSchema.parse({
      track: 'shore_role',
      title: 'Marine Superintendent',
      organization: 'Oceanic Shipping',
      location: 'Mumbai, India',
      startedOn: '2024-02-01',
      endedOn: '',
      isCurrent: 'on',
      description: 'Fleet safety, vetting and performance oversight.',
      vessel: 'should be removed',
      vesselType: 'should be removed',
      cargoExperience: 'should be removed',
      engineExperience: 'should be removed',
      tradingAreas: 'should be removed',
    })

    expect(parsed.track).toBe('shore_role')
    expect(parsed.organization).toBe('Oceanic Shipping')
    expect(parsed.location).toBe('Mumbai, India')
    expect(parsed.vessel).toBeNull()
    expect(parsed.vesselType).toBeNull()
    expect(parsed.cargoExperience).toEqual([])
    expect(parsed.engineExperience).toEqual([])
    expect(parsed.tradingAreas).toEqual([])
  })

  it('rejects an end date before the start date', () => {
    expect(() => profileExperienceInputSchema.parse({
      track: 'training',
      title: 'SIRE 2.0 Faculty',
      organization: 'Maritime Academy',
      location: 'Mumbai, India',
      startedOn: '2025-05-10',
      endedOn: '2025-05-01',
      description: '',
    })).toThrow()
  })
})

describe('profileCredentialInputSchema', () => {
  it('normalizes a CoC record and ignores any client-supplied verification state', () => {
    const parsed = profileCredentialInputSchema.parse({
      name: 'Certificate of Competency - Master',
      issuer: 'DG Shipping India',
      credentialNumber: ' COC-12345 ',
      issuedOn: '2023-04-12',
      expiresOn: '2028-04-11',
      noExpiry: '',
      verificationState: 'verified',
    })

    expect(parsed).toEqual({
      name: 'Certificate of Competency - Master',
      issuer: 'DG Shipping India',
      credentialNumber: 'COC-12345',
      issuedOn: '2023-04-12',
      expiresOn: '2028-04-11',
      noExpiry: false,
    })
    expect('verificationState' in parsed).toBe(false)
  })

  it('clears the expiry date when the member marks a certificate as no-expiry', () => {
    const parsed = profileCredentialInputSchema.parse({
      name: 'GMDSS General Operator Certificate',
      issuer: 'Maritime Authority',
      credentialNumber: '',
      issuedOn: '',
      expiresOn: '2030-01-01',
      noExpiry: 'on',
    })

    expect(parsed.noExpiry).toBe(true)
    expect(parsed.expiresOn).toBeNull()
    expect(parsed.credentialNumber).toBeNull()
    expect(parsed.issuedOn).toBeNull()
  })

  it('rejects an expiry date before the issue date', () => {
    expect(() => profileCredentialInputSchema.parse({
      name: 'Advanced Oil Tanker Training',
      issuer: 'Approved Training Institute',
      issuedOn: '2027-01-10',
      expiresOn: '2026-01-10',
      noExpiry: '',
    })).toThrow()
  })
})
