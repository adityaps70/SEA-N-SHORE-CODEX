import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

/**
 * Round GP safety net: is migration 0108 applied (profiles.country_of_residence / nationality /
 * country_prompt_dismissed_at, companies.country, public.member_signup_countries)? If this release runs before the
 * migration, every country read and write falls back to what the app did before (no country), instead of failing.
 *
 * Once present it is remembered for good (migrations are never rolled back here). While missing it is checked again
 * every 60 seconds, so the app picks the columns up within a minute of the migration. A failed check counts as
 * present for 60 seconds: that is today's behaviour, and the statement that follows reports its own error.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export const COUNTRY_SCHEMA_RECHECK_MS = 60_000

const PROBE_SQL = `select
    (select count(*)::int from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'profiles' and column_name in ('country_of_residence', 'nationality', 'country_prompt_dismissed_at'))
          or (table_name = 'companies' and column_name = 'country'))) as columns,
    to_regclass('public.member_signup_countries') is not null as signup_table`

export function createCountrySchemaProbe(input: { query?: Query; now?: () => number } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const now = input.now ?? Date.now
  let present = false
  let assumedUntil = 0
  let absentUntil = 0
  let inFlight: Promise<boolean> | null = null

  async function check(): Promise<boolean> {
    try {
      const rows = await query(PROBE_SQL)
      const row = rows[0] ?? {}
      present = Number(row.columns) === 4 && row.signup_table === true
      if (!present) absentUntil = now() + COUNTRY_SCHEMA_RECHECK_MS
      return present
    } catch {
      assumedUntil = now() + COUNTRY_SCHEMA_RECHECK_MS
      return true
    }
  }

  /** True when the country columns can be read and written. */
  async function ready(): Promise<boolean> {
    if (present) return true
    const at = now()
    if (at < assumedUntil) return true
    if (at < absentUntil) return false
    inFlight ??= check().finally(() => { inFlight = null })
    return inFlight
  }

  return { ready }
}

const defaultProbe = createCountrySchemaProbe()

export function countrySchemaReady(): Promise<boolean> {
  return defaultProbe.ready()
}

/** What Admin shows on a country page or action before migration 0108. */
export const COUNTRY_SCHEMA_MISSING_MESSAGE = 'Countries are not switched on yet: the database update for countries (migration 0108) has not been applied. Everything else works as before.'

/** Thrown where a country write cannot fall back (an admin setting a country before 0108). */
export class CountrySchemaMissingError extends Error {
  constructor() {
    super('country_schema_missing')
    this.name = 'CountrySchemaMissingError'
  }
}
