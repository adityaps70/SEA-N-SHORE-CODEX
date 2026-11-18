import { z } from 'zod'
import { COUNTRY_RECORDS, type CountryRecord } from './country-data'

/**
 * Round GP (Global Partners): the country list members and organizations choose from, and the two estimates Admin
 * may show for a member who has not chosen one (from their location text, or their phone's dialling code). Client
 * safe: no database or server imports.
 *
 * An estimate is never written into the member's profile: profiles.country_of_residence only ever holds a country
 * the member picked.
 */
export type CountryOption = { code: string; name: string }

const BY_CODE = new Map<string, CountryRecord>(COUNTRY_RECORDS.map((record) => [record.code, record]))

/** Every country, A to Z by name. */
export const COUNTRY_OPTIONS: readonly CountryOption[] = [...COUNTRY_RECORDS]
  .map(({ code, name }) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))

export function isCountryCode(value: unknown): value is string {
  return typeof value === 'string' && BY_CODE.has(value)
}

/** "Philippines" for "PH"; null for an unknown or empty code. */
export function countryName(code: string | null | undefined): string | null {
  return code ? BY_CODE.get(code)?.name ?? null : null
}

/**
 * Lower case, common accents removed, anything that is not a-z or 0-9 becomes one space: "Côte d’Ivoire" →
 * "cote d ivoire". COUNTRY_TEXT_SQL does the same in Postgres, so a key built here matches one built there.
 */
export const COUNTRY_TEXT_ACCENTS_FROM = 'áàâäãåāçćčéèêëēěíìîïīñńňóòôöõōřśšşúùûüūůýÿžźż'
export const COUNTRY_TEXT_ACCENTS_TO = 'aaaaaaaccceeeeeeiiiiinnnoooooorsssuuuuuuyyzzz'

export function normaliseCountryText(value: string): string {
  let lowered = value.toLowerCase()
  for (let index = 0; index < COUNTRY_TEXT_ACCENTS_FROM.length; index += 1) {
    lowered = lowered.replaceAll(COUNTRY_TEXT_ACCENTS_FROM[index]!, COUNTRY_TEXT_ACCENTS_TO[index]!)
  }
  return lowered.replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Every name and other name of every country, normalised, to its code. A name belongs to one country only. */
export const COUNTRY_NAME_KEYS: ReadonlyMap<string, string> = (() => {
  const keys = new Map<string, string>()
  for (const record of COUNTRY_RECORDS) {
    for (const name of [record.name, ...(record.aliases ?? [])]) {
      const key = normaliseCountryText(name)
      if (!key) continue
      const existing = keys.get(key)
      if (existing && existing !== record.code) throw new Error(`country name "${name}" belongs to ${existing} and ${record.code}`)
      keys.set(key, record.code)
    }
  }
  return keys
})()

/**
 * The country a free-text location clearly names: the whole text, or its last comma-separated part, is a country's
 * name or a common other name ("Manila, Philippines", "UAE"). A city alone ("Mumbai") names no country.
 */
export function countryFromLocation(location: string | null | undefined): string | null {
  if (!location) return null
  const whole = COUNTRY_NAME_KEYS.get(normaliseCountryText(location))
  if (whole) return whole
  const parts = location.split(',')
  if (parts.length < 2) return null
  return COUNTRY_NAME_KEYS.get(normaliseCountryText(parts.at(-1) ?? '')) ?? null
}

/** Dialling code (without "+") to country, for the longest-prefix phone estimate. */
export const COUNTRY_DIAL_CODES: ReadonlyMap<string, string> = (() => {
  const codes = new Map<string, string>()
  for (const record of COUNTRY_RECORDS) {
    for (const dial of record.dial) {
      const existing = codes.get(dial)
      if (existing && existing !== record.code) throw new Error(`dialling code ${dial} belongs to ${existing} and ${record.code}`)
      codes.set(dial, record.code)
    }
  }
  return codes
})()

export const COUNTRY_DIAL_CODE_MAX_LENGTH = Math.max(...[...COUNTRY_DIAL_CODES.keys()].map((dial) => dial.length))

/** The country of an international number's dialling code ("+639171234567" → "PH"), longest code first. */
export function countryFromPhone(phone: string | null | undefined): string | null {
  const digits = /^\+([1-9][0-9]{6,14})$/.exec(phone?.trim() ?? '')?.[1]
  if (!digits) return null
  for (let length = Math.min(COUNTRY_DIAL_CODE_MAX_LENGTH, digits.length); length >= 1; length -= 1) {
    const code = COUNTRY_DIAL_CODES.get(digits.slice(0, length))
    if (code) return code
  }
  return null
}

/** An optional country field from a form: empty means none; anything else must be a listed code. */
export const optionalCountryCodeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value ?? undefined),
  z.string().refine(isCountryCode, 'Choose a country from the list.').optional(),
)

/** A required country field from a form. */
export const requiredCountryCodeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.string({ error: 'Choose the country.' }).min(1, 'Choose the country.').refine(isCountryCode, 'Choose a country from the list.'),
)
