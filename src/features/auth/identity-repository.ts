import type { QueryResultRow } from 'pg'
import type { CognitoPrincipal } from '@/lib/auth/cognito-api'
import {
  query as databaseQuery,
  withTransaction as databaseWithTransaction,
  type DatabaseQueryClient,
} from '@/lib/db/client'

type IdentityRow = QueryResultRow & {
  profile_id: string
}

type IdentityQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<IdentityRow[]>

type IdentityTransaction = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>

export class IdentityMappingError extends Error {
  constructor() {
    super('Unable to resolve account identity.')
    this.name = 'IdentityMappingError'
  }
}

function normalizedProvisioningName(principal: CognitoPrincipal) {
  const cognitoName = principal.name?.trim()
  if (cognitoName && cognitoName.length >= 2 && cognitoName.length <= 160) return cognitoName

  const email = principal.email?.trim().toLowerCase()
  if (email && email.length >= 2 && email.length <= 160) return email

  return 'Sea N Shore Member'
}

function normalizedEmail(email: string | null) {
  const value = email?.trim().toLowerCase()
  return value && value.length >= 3 && value.length <= 320 ? value : null
}

export function createIdentityRepository(
  input: { query?: IdentityQuery; withTransaction?: IdentityTransaction } = {},
) {
  const queryRows: IdentityQuery = input.query ?? ((text, values) =>
    databaseQuery<IdentityRow>(text, values))
  const runTransaction = input.withTransaction ?? databaseWithTransaction

  async function resolveWithClient(client: DatabaseQueryClient, sub: string) {
    const result = await client.query<IdentityRow>(
      `select profile_id
       from public.identity_accounts
       where provider = $1
         and provider_subject = $2
       order by id
       limit 2`,
      ['cognito', sub],
    )

    if (result.rows.length === 0) return null
    if (result.rows.length !== 1) throw new IdentityMappingError()
    return result.rows[0]?.profile_id ?? null
  }

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

    async provisionProfileForCognitoPrincipal(principal: CognitoPrincipal): Promise<string> {
      if (!principal.sub.trim()) throw new IdentityMappingError()

      return runTransaction(async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `cognito:${principal.sub}`,
        ])

        const existingProfileId = await resolveWithClient(client, principal.sub)
        if (existingProfileId) return existingProfileId

        const profileResult = await client.query<IdentityRow>(
          `insert into public.profiles (id, full_name)
           values (gen_random_uuid(), $1)
           returning id as profile_id`,
          [normalizedProvisioningName(principal)],
        )
        const profileId = profileResult.rows[0]?.profile_id
        if (!profileId) throw new IdentityMappingError()

        await client.query(
          `insert into public.identity_accounts (
             profile_id,
             provider,
             provider_subject,
             email
           ) values ($1, $2, $3, $4)`,
          [profileId, 'cognito', principal.sub, normalizedEmail(principal.email)],
        )

        return profileId
      })
    },
  }
}

const identityRepository = createIdentityRepository()

export function resolveProfileIdForCognitoSub(sub: string) {
  return identityRepository.resolveProfileIdForCognitoSub(sub)
}

export function provisionProfileForCognitoPrincipal(principal: CognitoPrincipal) {
  return identityRepository.provisionProfileForCognitoPrincipal(principal)
}
