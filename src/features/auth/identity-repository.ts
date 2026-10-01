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
  onboarding_completed_at?: string | null
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
      `select ia.profile_id, p.onboarding_completed_at
       from public.identity_accounts ia
       join public.profiles p on p.id = ia.profile_id
       where ia.provider = $1
         and ia.provider_subject = $2
       order by ia.id
       limit 2`,
      ['cognito', sub],
    )

    if (result.rows.length === 0) return null
    if (result.rows.length !== 1) throw new IdentityMappingError()
    const row = result.rows[0]
    if (!row?.profile_id) throw new IdentityMappingError()
    return {
      profileId: row.profile_id,
      onboardingCompletedAt: row.onboarding_completed_at ?? null,
    }
  }

  async function matchingLegacyProfileIds(
    client: DatabaseQueryClient,
    principal: CognitoPrincipal,
  ): Promise<string[]> {
    const values = identityValues(principal)
    const matches = new Set<string>()

    if (values.emailVerified && values.email) {
      const emailRows = await client.query<IdentityRow>(
        `select distinct claim.profile_id
         from public.legacy_profile_claims claim
         join public.profiles profile on profile.id = claim.profile_id
         where claim.claimed_at is null
           and profile.account_status in ('active', 'restricted')
           and lower(claim.email) = lower($1)
         order by claim.profile_id
         limit 2`,
        [values.email],
      )
      for (const row of emailRows.rows) matches.add(row.profile_id)
    }

    if (values.phoneNumberVerified && values.phoneNumber) {
      const phoneRows = await client.query<IdentityRow>(
        `select distinct claim.profile_id
         from public.legacy_profile_claims claim
         join public.profiles profile on profile.id = claim.profile_id
         where claim.claimed_at is null
           and profile.account_status in ('active', 'restricted')
           and claim.phone_number = $1
         order by claim.profile_id
         limit 2`,
        [values.phoneNumber],
      )
      for (const row of phoneRows.rows) matches.add(row.profile_id)
    }

    if (matches.size > 1) throw new IdentityMappingError()
    return [...matches]
  }

  async function activateLegacyProfile(
    client: DatabaseQueryClient,
    profileId: string,
    principal: CognitoPrincipal,
  ) {
    await client.query(
      `update public.legacy_profile_claims
       set claimed_at = coalesce(claimed_at, now()),
           claimed_by_provider_subject = coalesce(claimed_by_provider_subject, $2),
           updated_at = now()
       where profile_id = $1
         and claimed_at is null`,
      [profileId, principal.sub],
    )
    await client.query(
      `update public.profiles
       set account_status = 'active',
           updated_at = now()
       where id = $1
         and account_status = 'restricted'`,
      [profileId],
    )
  }

  async function matchingVerifiedProfileIds(
    client: DatabaseQueryClient,
    principal: CognitoPrincipal,
    excludeProfileId?: string,
  ): Promise<string[]> {
    const values = identityValues(principal)
    const matches = new Set<string>()

    if (values.emailVerified && values.email) {
      const emailRows = await client.query<IdentityRow>(
        `select distinct profile_id
         from public.identity_accounts
         where email_verified = true
           and lower(email) = lower($1)
           ${excludeProfileId ? 'and profile_id <> $2' : ''}
         order by profile_id
         limit 2`,
        excludeProfileId ? [values.email, excludeProfileId] : [values.email],
      )
      for (const row of emailRows.rows) matches.add(row.profile_id)
    }

    if (values.phoneNumberVerified && values.phoneNumber) {
      const phoneRows = await client.query<IdentityRow>(
        `select distinct profile_id
         from public.identity_accounts
         where phone_number_verified = true
           and phone_number = $1
           ${excludeProfileId ? 'and profile_id <> $2' : ''}
         order by profile_id
         limit 2`,
        excludeProfileId ? [values.phoneNumber, excludeProfileId] : [values.phoneNumber],
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

  async function profileIsCompletedAndActive(
    client: DatabaseQueryClient,
    profileId: string,
  ) {
    const result = await client.query<IdentityRow>(
      `select id as profile_id, onboarding_completed_at
       from public.profiles
       where id = $1
         and account_status = 'active'
       limit 1`,
      [profileId],
    )
    return Boolean(result.rows[0]?.onboarding_completed_at)
  }

  async function reassignIdentityMapping(
    client: DatabaseQueryClient,
    principal: CognitoPrincipal,
    fromProfileId: string,
    toProfileId: string,
  ) {
    await client.query(
      `update public.identity_accounts
       set profile_id = $3,
           updated_at = now()
       where provider = $1
         and provider_subject = $2
         and profile_id = $4`,
      ['cognito', principal.sub, toProfileId, fromProfileId],
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

        const existingIdentity = await resolveWithClient(client, principal.sub)
        const values = identityValues(principal)

        if (existingIdentity) {
          if (
            !existingIdentity.onboardingCompletedAt
            && (values.emailVerified || values.phoneNumberVerified)
          ) {
            await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
              `verified-login:${values.email ?? ''}:${values.phoneNumber ?? ''}`,
            ])

            {
              const legacyProfileIds = await matchingLegacyProfileIds(client, principal)
              const legacyProfileId = legacyProfileIds[0] ?? null
              if (legacyProfileId && legacyProfileId !== existingIdentity.profileId) {
                await reassignIdentityMapping(
                  client,
                  principal,
                  existingIdentity.profileId,
                  legacyProfileId,
                )
                await activateLegacyProfile(client, legacyProfileId, principal)
                await refreshIdentityMapping(client, principal)
                return legacyProfileId
              }

              const matchedProfileIds = await matchingVerifiedProfileIds(
                client,
                principal,
                existingIdentity.profileId,
              )
              const matchedProfileId = matchedProfileIds[0] ?? null

              if (
                matchedProfileId
                && await profileIsCompletedAndActive(client, matchedProfileId)
              ) {
                await reassignIdentityMapping(
                  client,
                  principal,
                  existingIdentity.profileId,
                  matchedProfileId,
                )
                await refreshIdentityMapping(client, principal)
                return matchedProfileId
              }
            }
          }

          await refreshIdentityMapping(client, principal)
          return existingIdentity.profileId
        }

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

        const legacyProfileIds = await matchingLegacyProfileIds(client, principal)
        const legacyProfileId = legacyProfileIds[0] ?? null
        if (legacyProfileId) {
          await insertIdentityMapping(client, legacyProfileId, principal)
          await activateLegacyProfile(client, legacyProfileId, principal)
          return legacyProfileId
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
