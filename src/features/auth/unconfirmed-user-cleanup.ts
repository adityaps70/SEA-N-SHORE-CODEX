import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider'
import { query as databaseQuery } from '@/lib/db/client'
import { isPhoneLoginEmail } from './phone-login-email'

/**
 * Round 14 (2.7): removes sign-ups that never finished, once a day.
 * - Email sign-ups still UNCONFIRMED (the code was never entered).
 * - Mobile sign-ups (synthetic phone-…@auth.seaandshore.in users) whose number was never verified.
 * Only users older than 24 h, and never anyone who has signed in (an identity_accounts row).
 * Deletes at most MAX_DELETIONS_PER_RUN users per run and logs counts only.
 */
export const UNCONFIRMED_USER_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const MAX_DELETIONS_PER_RUN = 200
const PAGE_SIZE = 60

type CognitoClient = Pick<CognitoIdentityProviderClient, 'send'>
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export type UnconfirmedUserCleanupResult = {
  scanned: number
  deleted: number
  skippedSignedIn: number
  failed: number
}

function attribute(user: UserType, name: string) {
  return user.Attributes?.find((item) => item.Name === name)?.Value
}

/** True when a user is an abandoned sign-up that is old enough to remove. */
export function isAbandonedSignUp(user: UserType, now: number) {
  const created = user.UserCreateDate?.getTime()
  if (!user.Username || !created || now - created < UNCONFIRMED_USER_MAX_AGE_MS) return false
  if (user.UserStatus === 'UNCONFIRMED') return true
  const email = attribute(user, 'email') ?? ''
  return user.UserStatus === 'CONFIRMED' && isPhoneLoginEmail(email) && attribute(user, 'phone_number_verified') !== 'true'
}

export function createUnconfirmedUserCleanup(input: {
  userPoolId?: string
  client?: CognitoClient
  query?: Query
  now?: () => number
} = {}) {
  const userPoolId = input.userPoolId ?? process.env.AWS_COGNITO_USER_POOL_ID
  const client = input.client ?? new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' })
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const now = input.now ?? Date.now

  async function hasSignedIn(username: string) {
    const rows = await queryRows(
      `select exists (
         select 1 from public.identity_accounts
         where provider = 'cognito' and provider_username = $1
       ) as signed_in`,
      [username],
    )
    return rows[0]?.signed_in === true
  }

  async function* candidates(filter: string) {
    let paginationToken: string | undefined
    do {
      const page = await client.send(new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: filter,
        Limit: PAGE_SIZE,
        PaginationToken: paginationToken,
      }))
      for (const user of page.Users ?? []) yield user
      paginationToken = page.PaginationToken
    } while (paginationToken)
  }

  return {
    async run(): Promise<UnconfirmedUserCleanupResult> {
      if (!userPoolId) throw new Error('AWS_COGNITO_USER_POOL_ID is required')
      const result: UnconfirmedUserCleanupResult = { scanned: 0, deleted: 0, skippedSignedIn: 0, failed: 0 }
      const startedAt = now()

      // Cognito filters on one attribute: unconfirmed email sign-ups, then mobile sign-ups by their synthetic email.
      for (const filter of ['cognito:user_status = "UNCONFIRMED"', 'email ^= "phone-"']) {
        for await (const user of candidates(filter)) {
          if (result.deleted >= MAX_DELETIONS_PER_RUN) return result
          result.scanned += 1
          if (!isAbandonedSignUp(user, startedAt)) continue
          const username = user.Username as string
          if (await hasSignedIn(username)) {
            result.skippedSignedIn += 1
            continue
          }
          try {
            await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }))
            result.deleted += 1
          } catch (error) {
            if (error instanceof Error && error.name === 'UserNotFoundException') continue
            result.failed += 1
          }
        }
      }
      return result
    },
  }
}
