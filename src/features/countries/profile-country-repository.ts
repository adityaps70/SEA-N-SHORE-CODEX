import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { CountrySchemaMissingError, countrySchemaReady } from './country-schema'

/**
 * Round GP (Global Partners), Part A: a member's own country of residence and nationality, and the one-time "add your
 * country" prompt. Only the member's own choices are stored here; Admin's estimates are never written back.
 */
type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>

export type ProfileCountries = {
  countryOfResidence: string | null
  nationality: string | null
  /** True when the prompt should show: no country of residence, and the member has not closed it. */
  showPrompt: boolean
}

export function createProfileCountryRepository(input: { query?: Query; countrySchemaReady?: () => Promise<boolean> } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<Row>(text, values))
  // Round GP safety net: before migration 0108 there is nothing to read (no prompt) and a save is refused.
  const countryColumnsReady = input.countrySchemaReady ?? countrySchemaReady

  async function getOwnCountries(profileId: string): Promise<ProfileCountries | null> {
    if (!await countryColumnsReady()) return null
    const rows = await query(
      `select country_of_residence, nationality, country_prompt_dismissed_at
       from public.profiles
       where id = $1 and account_status = 'active'`,
      [profileId],
    )
    const row = rows[0]
    if (!row) return null
    const countryOfResidence = typeof row.country_of_residence === 'string' ? row.country_of_residence : null
    return {
      countryOfResidence,
      nationality: typeof row.nationality === 'string' ? row.nationality : null,
      showPrompt: !countryOfResidence && !row.country_prompt_dismissed_at,
    }
  }

  /** Saves both fields as the member chose them (null clears one). True when the member's row was updated. */
  async function saveOwnCountries(profileId: string, countries: { countryOfResidence: string | null; nationality: string | null }) {
    if (!await countryColumnsReady()) throw new CountrySchemaMissingError()
    const rows = await query(
      `update public.profiles
       set country_of_residence = $2, nationality = $3, updated_at = now()
       where id = $1 and account_status = 'active'
       returning id`,
      [profileId, countries.countryOfResidence, countries.nationality],
    )
    return rows.length === 1
  }

  /** Closes the prompt for good. Saving a country also hides it. */
  async function dismissPrompt(profileId: string) {
    if (!await countryColumnsReady()) return
    await query(
      `update public.profiles
       set country_prompt_dismissed_at = coalesce(country_prompt_dismissed_at, now())
       where id = $1 and account_status = 'active'`,
      [profileId],
    )
  }

  return { getOwnCountries, saveOwnCountries, dismissPrompt }
}

export const profileCountryRepository = createProfileCountryRepository()
