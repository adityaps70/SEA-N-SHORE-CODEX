import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { plainIssueMessage } from '@/lib/validation/plain-messages'
import { parseSiteSetting, SITE_SETTING_SCHEMAS, type SiteSettingKey, type SiteSettingValue } from './schemas'

/**
 * Round H (H7): typed access to public.site_settings (migration 0089). Every read goes through the key's
 * schema; every write is validated, saved with who changed it, and leaves one audit_events row with the
 * previous and new value, in the same transaction.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

function jsonValue(value: unknown) {
  return typeof value === 'string' ? JSON.parse(value) as unknown : value
}

export class SiteSettingValidationError extends Error {
  constructor(readonly issues: string[]) {
    super('site_setting_invalid')
    this.name = 'SiteSettingValidationError'
  }
}

export function createSiteSettingsRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function get<K extends SiteSettingKey>(key: K): Promise<SiteSettingValue<K>> {
    const rows = await queryRows(`select value from public.site_settings where key = $1`, [key])
    return parseSiteSetting(key, rows[0] ? jsonValue(rows[0].value) : undefined)
  }

  /** Validates, saves and audits one setting. Returns the saved (normalized) value. */
  async function set<K extends SiteSettingKey>(key: K, value: unknown, actorId: string): Promise<SiteSettingValue<K>> {
    const parsed = SITE_SETTING_SCHEMAS[key].safeParse(value)
    if (!parsed.success) throw new SiteSettingValidationError(parsed.error.issues.map((issue) => plainIssueMessage(issue)))
    const next = parsed.data as SiteSettingValue<K>
    return transaction(async (query) => {
      const previousRows = await query(`select value from public.site_settings where key = $1 for update`, [key])
      const previous = previousRows[0] ? jsonValue(previousRows[0].value) : null
      await query(
        `insert into public.site_settings (key, value, updated_by, updated_at)
         values ($1, $2::jsonb, $3, now())
         on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [key, JSON.stringify(next), actorId],
      )
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'site_setting.updated', 'site_setting', $2, $3::jsonb)`,
        [actorId, key, JSON.stringify({ key, previous, next })],
      )
      return next
    })
  }

  return { get, set }
}

export const siteSettingsRepository = createSiteSettingsRepository()
