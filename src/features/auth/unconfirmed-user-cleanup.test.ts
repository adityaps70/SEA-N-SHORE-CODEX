import { AdminDeleteUserCommand, ListUsersCommand, type UserType } from '@aws-sdk/client-cognito-identity-provider'
import { describe, expect, it, vi } from 'vitest'
import { createUnconfirmedUserCleanup, isAbandonedSignUp, MAX_DELETIONS_PER_RUN } from './unconfirmed-user-cleanup'

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0)
const OLD = new Date(NOW - 25 * 60 * 60 * 1000)
const FRESH = new Date(NOW - 2 * 60 * 60 * 1000)
const PHONE_EMAIL = 'phone-0123456789abcdef0123456789abcdef@auth.seaandshore.in'

function user(username: string, status: string, created: Date, attributes: Record<string, string> = {}): UserType {
  return {
    Username: username,
    UserStatus: status as UserType['UserStatus'],
    UserCreateDate: created,
    Attributes: Object.entries(attributes).map(([Name, Value]) => ({ Name, Value })),
  }
}

function fakeCognito(pages: Record<string, UserType[]>, deleteError?: Error) {
  const deleted: string[] = []
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof ListUsersCommand) return { Users: pages[command.input.Filter as string] ?? [] }
    if (command instanceof AdminDeleteUserCommand) {
      if (deleteError) throw deleteError
      deleted.push(command.input.Username as string)
      return {}
    }
    throw new Error('unexpected command')
  })
  return { client: { send } as never, deleted, send }
}

describe('abandoned sign-up cleanup (Round 14, 2.7)', () => {
  it('recognises unconfirmed email sign-ups and unverified mobile sign-ups older than 24 h only', () => {
    expect(isAbandonedSignUp(user('a', 'UNCONFIRMED', OLD), NOW)).toBe(true)
    expect(isAbandonedSignUp(user('b', 'UNCONFIRMED', FRESH), NOW)).toBe(false)
    expect(isAbandonedSignUp(user('c', 'CONFIRMED', OLD, { email: PHONE_EMAIL }), NOW)).toBe(true)
    expect(isAbandonedSignUp(user('d', 'CONFIRMED', OLD, { email: PHONE_EMAIL, phone_number_verified: 'true' }), NOW)).toBe(false)
    expect(isAbandonedSignUp(user('e', 'CONFIRMED', OLD, { email: 'member@example.com' }), NOW)).toBe(false)
    expect(isAbandonedSignUp(user('f', 'EXTERNAL_PROVIDER', OLD, { email: 'g@example.com' }), NOW)).toBe(false)
  })

  it('deletes only abandoned sign-ups that never signed in, and reports counts', async () => {
    const { client, deleted } = fakeCognito({
      'cognito:user_status = "UNCONFIRMED"': [user('old-unconfirmed', 'UNCONFIRMED', OLD), user('fresh', 'UNCONFIRMED', FRESH)],
      'email ^= "phone-"': [
        user('phone-unverified', 'CONFIRMED', OLD, { email: PHONE_EMAIL }),
        user('phone-verified', 'CONFIRMED', OLD, { email: PHONE_EMAIL, phone_number_verified: 'true' }),
        user('phone-signed-in', 'CONFIRMED', OLD, { email: PHONE_EMAIL }),
      ],
    })
    const query = vi.fn(async (_text: string, values?: readonly unknown[]) => [{ signed_in: values?.[0] === 'phone-signed-in' }])
    const result = await createUnconfirmedUserCleanup({ userPoolId: 'ap-south-1_test', client, query, now: () => NOW }).run()

    expect(deleted).toEqual(['old-unconfirmed', 'phone-unverified'])
    expect(result).toEqual({ scanned: 5, deleted: 2, skippedSignedIn: 1, failed: 0 })
    expect(query.mock.calls[0]?.[0]).toMatch(/provider = 'cognito' and provider_username = \$1/)
  })

  it('stops at the per-run cap and treats an already-deleted user as done', async () => {
    const many = Array.from({ length: MAX_DELETIONS_PER_RUN + 5 }, (_, index) => user(`u${index}`, 'UNCONFIRMED', OLD))
    const capped = fakeCognito({ 'cognito:user_status = "UNCONFIRMED"': many })
    const query = vi.fn(async () => [{ signed_in: false }])
    const result = await createUnconfirmedUserCleanup({ userPoolId: 'pool', client: capped.client, query, now: () => NOW }).run()
    expect(result.deleted).toBe(MAX_DELETIONS_PER_RUN)

    const gone = Object.assign(new Error('gone'), { name: 'UserNotFoundException' })
    const missing = fakeCognito({ 'cognito:user_status = "UNCONFIRMED"': [user('x', 'UNCONFIRMED', OLD)] }, gone)
    expect(await createUnconfirmedUserCleanup({ userPoolId: 'pool', client: missing.client, query, now: () => NOW }).run())
      .toEqual({ scanned: 1, deleted: 0, skippedSignedIn: 0, failed: 0 })
  })
})
