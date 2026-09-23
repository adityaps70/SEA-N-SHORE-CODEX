import type { QueryResultRow } from 'pg'
import type { CognitoPrincipal } from '@/lib/auth/cognito-api'
import {
  query as databaseQuery,
  withTransaction as databaseWithTransaction,
  type DatabaseQueryClient,
} from '@/lib/db/client'

type IdentityRow = QueryResultRow & {
  profile_id: string
  account_status?: 'active' | 'restricted' | 'suspended' | 'deletion_requested'
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

function normalizedPhoneNumber(phoneNumber: string | null | undefined) {
  const value = phoneNumber?.trim()
  return value && /^\+[1-9]\d{7,14}$/.test(value) ? value : null
}

function identityValues(principal: CognitoPrincipal) {
  const email = normalizedEmail(principal.email)
  const phoneNumber = normalizedPhoneNumber(principal.phoneNumber)
  return {
    username: principal.username?.trim() || null,
    email,
    emailVerified: Boolean(email && principal.emailVerified),
    phoneNumber,
    phoneNumberVerified: Boolean(phoneNumber && principal.phoneNumberVerified),
  }
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

  async function matchingVerifiedProfileIds(
    client: DatabaseQueryClient,
    principal: CognitoPrincipal,
  ): Promise<string[]> {
    const values = identityValues(principal)
    const matches = new Set<string>()

    if (values.emailVerified && values.email) {
      const emailRows = await client.query<IdentityRow>(
        `select distinct profile_id
         from public.identity_accounts
         where email_verified = true
           and lower(email) = lower($1)
         order by profile_id
         limit 2`,
        [values.email],
      )
      for (const row of emailRows.rows) matches.add(row.profile_id)
    }

    if (values.phoneNumberVerified && values.phoneNumber) {
      const phoneRows = await client.query<IdentityRow>(
        `select distinct profile_id
         from public.identity_accounts
         where phone_number_verified = true
           and phone_number = $1
         order by profile_id
         limit 2`,
        [values.phoneNumber],
      )
      for (const row of phoneRows.rows) matches.add(row.profile_id)
    }

    if (matches.size > 1) throw new IdentityMappingError()
    return [...matches]
  }

  async function insertIdentityMapping(
    client: DatabaseQueryClient,
    profileId: string,
    principal: CognitoPrincipal,
  ) {
    const values = identityValues(principal)
    await client.query(
      `insert into public.identity_accounts (
         profile_id,
         provider,
         provider_subject,
         provider_username,
         email,
         email_verified,
         phone_number,
         phone_number_verified
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        profileId,
        'cognito',
        principal.sub,
        values.username,
        values.email,
        values.emailVerified,
        values.phoneNumber,
        values.phoneNumberVerified,
      ],
    )
  }

  async function refreshIdentityMapping(
    client: DatabaseQueryClient,
    principal: CognitoPrincipal,
  ) {
    const values = identityValues(principal)
    await client.query(
      `update public.identity_accounts
       set provider_username = coalesce($3, provider_username),
           email = coalesce($4, email),
           email_verified = case when $4 is null then email_verified else $5 end,
           phone_number = coalesce($6, phone_number),
           phone_number_verified = case when $6 is null then phone_number_verified else $7 end,
           updated_at = now()
       where provider = $1
         and provider_subject = $2`,
      [
        'cognito',
        principal.sub,
        values.username,
        values.email,
        values.emailVerified,
        values.phoneNumber,
        values.phoneNumberVerified,
      ],
    )
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

    async getProfileAccountStatus(profileId: string) {
      const rows = await queryRows(
        `select id as profile_id, account_status::text as account_status
         from public.profiles
         where id = $1
         limit 1`,
        [profileId],
      )
      const status = rows[0]?.account_status
      return status === 'active'
        || status === 'restricted'
        || status === 'suspended'
        || status === 'deletion_requested'
        ? status
        : null
    },

    async provisionProfileForCognitoPrincipal(principal: CognitoPrincipal): Promise<string> {
      if (!principal.sub.trim()) throw new IdentityMappingError()

      return runTransaction(async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `cognito:${principal.sub}`,
        ])

        const existingProfileId = await resolveWithClient(client, principal.sub)
        if (existingProfileId) {
          await refreshIdentityMapping(client, principal)
          return existingProfileId
        }

        const values = identityValues(principal)
        if (values.emailVerified || values.phoneNumberVerified) {
          await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
            `verified-login:${values.email ?? ''}:${values.phoneNumber ?? ''}`,
          ])
        }

        const matchedProfileIds = await matchingVerifiedProfileIds(client, principal)
        const matchedProfileId = matchedProfileIds[0] ?? null
        if (matchedProfileId) {
          await insertIdentityMapping(client, matchedProfileId, principal)
          return matchedProfileId
        }

        const profileResult = await client.query<IdentityRow>(
          `insert into public.profiles (id, full_name)
           values (gen_random_uuid(), $1)
           returning id as profile_id`,
          [normalizedProvisioningName(principal)],
        )
        const profileId = profileResult.rows[0]?.profile_id
        if (!profileId) throw new IdentityMappingError()

        await insertIdentityMapping(client, profileId, principal)

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

export function getProfileAccountStatus(profileId: string) {
  return identityRepository.getProfileAccountStatus(profileId)
}
