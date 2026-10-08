import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

/**
 * The Cognito sign-ins linked to a profile through public.identity_accounts (multi-login
 * model: email/password and Google). Read-only; used to decide how a session re-authenticates
 * before account deletion.
 */

type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>

export type SignInIdentity = {
  id: string
  providerSubject: string
  providerUsername: string | null
  email: string | null
  emailVerified: boolean
}

function mapIdentity(row: Row): SignInIdentity {
  return {
    id: String(row.id),
    providerSubject: String(row.provider_subject),
    providerUsername: typeof row.provider_username === 'string' ? row.provider_username : null,
    email: typeof row.email === 'string' ? row.email : null,
    emailVerified: row.email_verified === true,
  }
}

export function createSignInIdentityRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<Row>(text, values))

  return {
    async listSignInIdentities(profileId: string): Promise<SignInIdentity[]> {
      const rows = await queryRows(
        `select id, provider_subject, provider_username, email, email_verified
         from public.identity_accounts
         where profile_id = $1
           and provider = 'cognito'
         order by created_at asc, id asc`,
        [profileId],
      )
      return rows.map(mapIdentity)
    },
  }
}

export type SignInIdentityRepository = ReturnType<typeof createSignInIdentityRepository>

export const signInIdentityRepository = createSignInIdentityRepository()
