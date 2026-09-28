import type { QueryResultRow } from 'pg'
import {
  query as databaseQuery,
  withTransaction as databaseWithTransaction,
  type DatabaseQueryClient,
} from '@/lib/db/client'

/**
 * Database side of "add a mobile number to my account". A mobile sign-in is its own
 * Cognito user, linked to the member's profile through public.identity_accounts, the
 * same way every other sign-in (email, Google) is linked in the multi-login model.
 */

type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>
type Transaction = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>

export type SignInIdentity = {
  id: string
  providerSubject: string
  providerUsername: string | null
  email: string | null
  emailVerified: boolean
  phoneNumber: string | null
  phoneNumberVerified: boolean
}

export type CodeRequestHistory = {
  lastForProfileAt: Date | null
  forProfileLastHour: number
  forPhoneLastHour: number
}

/** The number already belongs to another member's sign-in. Nothing was linked. */
export class PhoneNumberInUseError extends Error {
  constructor() {
    super('phone_number_in_use')
    this.name = 'PhoneNumberInUseError'
  }
}

function mapIdentity(row: Row): SignInIdentity {
  return {
    id: String(row.id),
    providerSubject: String(row.provider_subject),
    providerUsername: typeof row.provider_username === 'string' ? row.provider_username : null,
    email: typeof row.email === 'string' ? row.email : null,
    emailVerified: row.email_verified === true,
    phoneNumber: typeof row.phone_number === 'string' ? row.phone_number : null,
    phoneNumberVerified: row.phone_number_verified === true,
  }
}

function toDate(value: unknown) {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

export function createPhoneLinkRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<Row>(text, values))
  const transaction: Transaction = input.transaction ?? databaseWithTransaction

  return {
    async listSignInIdentities(profileId: string): Promise<SignInIdentity[]> {
      const rows = await queryRows(
        `select id, provider_subject, provider_username, email, email_verified, phone_number, phone_number_verified
         from public.identity_accounts
         where profile_id = $1
           and provider = 'cognito'
         order by created_at asc, id asc`,
        [profileId],
      )
      return rows.map(mapIdentity)
    },

    async profileIdForSubject(sub: string): Promise<string | null> {
      const rows = await queryRows(
        `select profile_id
         from public.identity_accounts
         where provider = 'cognito' and provider_subject = $1
         limit 1`,
        [sub],
      )
      return typeof rows[0]?.profile_id === 'string' ? rows[0].profile_id : null
    },

    /** Profiles that already sign in with this verified number. */
    async verifiedPhoneOwners(phoneNumber: string): Promise<string[]> {
      const rows = await queryRows(
        `select distinct profile_id
         from public.identity_accounts
         where phone_number = $1
           and phone_number_verified = true`,
        [phoneNumber],
      )
      return rows.map((row) => String(row.profile_id))
    },

    async getProfileName(profileId: string): Promise<string | null> {
      const rows = await queryRows('select full_name from public.profiles where id = $1 limit 1', [profileId])
      return typeof rows[0]?.full_name === 'string' ? rows[0].full_name : null
    },

    async codeRequestHistory(profileId: string, phoneNumber: string): Promise<CodeRequestHistory> {
      const rows = await queryRows(
        `select
           (select max(created_at) from public.phone_link_code_requests where profile_id = $1) as last_for_profile_at,
           (select count(*)::int from public.phone_link_code_requests
             where profile_id = $1 and created_at > now() - interval '1 hour') as for_profile_last_hour,
           (select count(*)::int from public.phone_link_code_requests
             where phone_number = $2 and created_at > now() - interval '1 hour') as for_phone_last_hour`,
        [profileId, phoneNumber],
      )
      const row = rows[0] ?? {}
      return {
        lastForProfileAt: toDate(row.last_for_profile_at),
        forProfileLastHour: Number(row.for_profile_last_hour ?? 0),
        forPhoneLastHour: Number(row.for_phone_last_hour ?? 0),
      }
    },

    async recordCodeRequest(profileId: string, phoneNumber: string) {
      await queryRows(
        `insert into public.phone_link_code_requests (profile_id, phone_number)
         values ($1, $2)`,
        [profileId, phoneNumber],
      )
    },

    /**
     * Links a verified mobile sign-in to the profile in one transaction. `markVerified`
     * (Cognito phone_number_verified=true) runs inside it, after the checks and the
     * insert, so a failure leaves nothing half-linked.
     */
    async linkPhoneIdentity(
      link: { profileId: string; sub: string; username: string; email: string | null; phoneNumber: string },
      markVerified: () => Promise<void>,
    ) {
      await transaction(async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `verified-login::${link.phoneNumber}`,
        ])
        const owners = await client.query<Row>(
          `select distinct profile_id
           from public.identity_accounts
           where profile_id <> $1
             and (
               provider_subject = $2
               or (phone_number = $3 and phone_number_verified = true)
             )`,
          [link.profileId, link.sub, link.phoneNumber],
        )
        if (owners.rows.length) throw new PhoneNumberInUseError()

        await client.query(
          `insert into public.identity_accounts (
             profile_id, provider, provider_subject, provider_username, email, email_verified, phone_number, phone_number_verified
           ) values ($1, 'cognito', $2, $3, $4, false, $5, true)
           on conflict (provider, provider_subject) do update
             set provider_username = excluded.provider_username,
                 email = coalesce(excluded.email, public.identity_accounts.email),
                 phone_number = excluded.phone_number,
                 phone_number_verified = true,
                 updated_at = now()
             where public.identity_accounts.profile_id = excluded.profile_id`,
          [link.profileId, link.sub, link.username, link.email?.trim().toLowerCase() || null, link.phoneNumber],
        )
        await markVerified()
      })
    },

    async unlinkIdentity(profileId: string, identityId: string) {
      await queryRows(
        `delete from public.identity_accounts
         where id = $1 and profile_id = $2`,
        [identityId, profileId],
      )
    },
  }
}

export type PhoneLinkRepository = ReturnType<typeof createPhoneLinkRepository>

export const phoneLinkRepository = createPhoneLinkRepository()
