import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from './client'

type HealthRow = QueryResultRow & {
  database_ok: number
  identity_mappings_ok: boolean
}

type HealthQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<HealthRow[]>

export type Phase4DatabaseHealth = {
  database: boolean
  identityMappings: boolean
}

export function createPhase4DatabaseHealthCheck(input: { query?: HealthQuery } = {}) {
  const queryRows: HealthQuery = input.query ?? ((text, values) => databaseQuery<HealthRow>(text, values))

  return async function checkPhase4DatabaseHealth(): Promise<Phase4DatabaseHealth> {
    const rows = await queryRows(
      `select
         1::int as database_ok,
         (
           select count(*) = 7
           from public.identity_accounts
           where provider = $1
         ) as identity_mappings_ok`,
      ['cognito'],
    )

    const row = rows[0]
    return {
      database: row?.database_ok === 1,
      identityMappings: row?.identity_mappings_ok === true,
    }
  }
}

export const checkPhase4DatabaseHealth = createPhase4DatabaseHealthCheck()
