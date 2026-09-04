import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

type IdentityRow = QueryResultRow & {
  profile_id: string
}

type IdentityQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<IdentityRow[]>

export class IdentityMappingError extends Error {
  constructor() {
    super('Unable to resolve account identity.')
    this.name = 'IdentityMappingError'
  }
}

export function createIdentityRepository(input: { query?: IdentityQuery } = {}) {
  const queryRows: IdentityQuery = input.query ?? ((text, values) =>
    databaseQuery<IdentityRow>(text, values))

  return {
    async resolveProfileIdForCognitoSub(sub: string): Promise<string | null> {
      const rows = await queryRows(
        `select profile_id
         from public.identity_accounts
         where provider = $1
           and provider_subject = $2
         order by id
         limit 2`,
        ['cognito', sub],
      )

      if (rows.length === 0) return null
      if (rows.length !== 1) throw new IdentityMappingError()

      return rows[0]?.profile_id ?? null
    },
  }
}

const identityRepository = createIdentityRepository()

export function resolveProfileIdForCognitoSub(sub: string) {
  return identityRepository.resolveProfileIdForCognitoSub(sub)
}
