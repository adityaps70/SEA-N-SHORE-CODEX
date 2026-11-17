import { describe, expect, it } from 'vitest'
import {
  COUNTRY_DIAL_CODES,
  COUNTRY_NAME_KEYS,
  COUNTRY_OPTIONS,
  countryFromLocation,
  countryFromPhone,
  countryName,
  isCountryCode,
  normaliseCountryText,
  optionalCountryCodeSchema,
  requiredCountryCodeSchema,
} from './catalog'

describe('country catalog (Round GP)', () => {
  it('lists every country once, by a two-letter code, A to Z', () => {
    const codes = COUNTRY_OPTIONS.map((option) => option.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true)
    expect(codes.length).toBeGreaterThan(240)
    for (const code of ['IN', 'PH', 'AE', 'SG', 'GB', 'US', 'XK']) expect(isCountryCode(code)).toBe(true)
    for (const retired of ['UK', 'EU', 'ZZ', 'XX', 'SU', 'YU', 'in']) expect(isCountryCode(retired)).toBe(false)
    expect(countryName('PH')).toBe('Philippines')
    expect(countryName('CI')).toBe("Côte d'Ivoire")
    expect(countryName(null)).toBeNull()
  })

  it('names in location text: whole text or the last comma part, never a city alone', () => {
    expect(countryFromLocation('Manila, Philippines')).toBe('PH')
    expect(countryFromLocation('Philippines')).toBe('PH')
    expect(countryFromLocation('Dubai, UAE')).toBe('AE')
    expect(countryFromLocation('London, UK')).toBe('GB')
    expect(countryFromLocation('Istanbul, Turkey')).toBe('TR')
    expect(countryFromLocation('Abidjan, Côte d’Ivoire')).toBe('CI')
    expect(countryFromLocation('Mumbai')).toBeNull()
    expect(countryFromLocation('Philippine Sea')).toBeNull()
    expect(countryFromLocation('')).toBeNull()
    expect(normaliseCountryText('  São Tomé  and  Príncipe ')).toBe('sao tome and principe')
    expect(COUNTRY_NAME_KEYS.get('india')).toBe('IN')
  })

  it('estimates from the longest matching dialling code', () => {
    expect(countryFromPhone('+639171234567')).toBe('PH')
    expect(countryFromPhone('+919812345678')).toBe('IN')
    expect(countryFromPhone('+12125551234')).toBe('US')
    expect(countryFromPhone('+14165551234')).toBe('CA')
    expect(countryFromPhone('+18765551234')).toBe('JM')
    expect(countryFromPhone('+447700900123')).toBe('GB')
    expect(countryFromPhone('+441481123456')).toBe('GG')
    expect(countryFromPhone('+77012345678')).toBe('KZ')
    expect(countryFromPhone('+79161234567')).toBe('RU')
    expect(countryFromPhone('9812345678')).toBeNull()
    expect([...COUNTRY_DIAL_CODES.values()].every(isCountryCode)).toBe(true)
  })

  it('reads optional and required country fields from forms', () => {
    expect(optionalCountryCodeSchema.parse('')).toBeUndefined()
    expect(optionalCountryCodeSchema.parse(' ph ')).toBe('PH')
    expect(optionalCountryCodeSchema.safeParse('QQ').success).toBe(false)
    expect(requiredCountryCodeSchema.safeParse('').success).toBe(false)
    expect(requiredCountryCodeSchema.parse('in')).toBe('IN')
  })
})
