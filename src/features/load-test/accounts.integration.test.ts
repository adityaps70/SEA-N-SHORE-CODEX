import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync, privateDecrypt, createDecipheriv, constants as cryptoConstants } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * Round ARCH (Phase 1) against the real schema (PGlite, every migration): the load-test accounts are created through
 * the app's own provisioning and onboarding, follow only each other, live in one hidden community, get sealed sessions,
 * and are deleted with nothing left behind. A real account is never touched. Cognito is an in-memory fake.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { createLoadTestAccounts, LOAD_TEST_ACCOUNT_COUNT, loadTestEmail } = await import('./accounts')
const { provisionProfileForCognitoPrincipal } = await import('@/features/auth/identity-repository')
const { createOnboardingService } = await import('@/features/profiles/onboarding-service')
const { createOnboardingRepositoryForClient } = await import('@/features/profiles/onboarding-repository')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const users = new Map<string, { sub: string; password: string | null; signedOut: number }>()
const lines: string[] = []
let subSequence = 0

function accounts() {
  return createLoadTestAccounts(accountsDeps())
}

function accountsDeps(): Parameters<typeof createLoadTestAccounts>[0] {
  const onboarding = createOnboardingService({
    withTransaction: (fn) => db.transaction((query) => fn(createOnboardingRepositoryForClient({ query: async (text: string, values?: readonly unknown[]) => ({ rows: await query(text, values) }) } as never))),
  })
  return {
    query: (text, values) => db.query(text, values) as Promise<Array<Record<string, unknown>>>,
    transaction: (work) => db.transaction((query) => work(query as never)),
    cognito: {
      findUserSub: async (email) => users.get(email)?.sub ?? null,
      createUser: async (email) => {
        subSequence += 1
        const sub = `00000000-0000-4000-8000-${String(subSequence).padStart(12, '0')}`
        users.set(email, { sub, password: null, signedOut: 0 })
        return sub
      },
      setPassword: async (email, password) => { users.get(email)!.password = password },
      signIn: async (email, password) => {
        if (users.get(email)?.password !== password) throw new Error('bad password')
        return { accessToken: `access-${email}`, refreshToken: `refresh-${email}` }
      },
      deleteUser: async (email) => { users.delete(email) },
      globalSignOut: async (email) => { users.get(email)!.signedOut += 1 },
    },
    provisionProfile: (principal) => provisionProfileForCognitoPrincipal(principal),
    completeActivation: (profileId, input) => onboarding.completeActivation(profileId, input),
    log: (line) => lines.push(line),
  }
}

describe('load-test accounts (Round ARCH)', () => {
  it('creates 50 onboarded, flagged accounts that follow only each other, in one hidden community with one post', async () => {
    const realRows = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Real Member') returning id`)
    const realId = realRows[0]!.id as string
    await accounts().create()
    const counts = await accounts().counts()
    expect(counts).toEqual({ profiles: LOAD_TEST_ACCOUNT_COUNT, communities: 1, follows: LOAD_TEST_ACCOUNT_COUNT * (LOAD_TEST_ACCOUNT_COUNT - 1), mixedFollows: 0, posts: 1 })
    const onboarded = await db.query(`select count(*)::int as n from public.profiles where is_load_test and onboarding_completed_at is not null`)
    expect(onboarded[0]!.n).toBe(LOAD_TEST_ACCOUNT_COUNT)
    const group = await db.query(`select visibility from public.community_groups where is_load_test`)
    expect(group[0]!.visibility).toBe('private')
    const real = await db.query(`select is_load_test from public.profiles where id = $1`, [realId])
    expect(real[0]!.is_load_test).toBe(false)
    // Running it again changes nothing.
    await accounts().create()
    expect(await accounts().counts()).toEqual(counts)
    expect(lines.join('\n')).not.toMatch(/@|Load Test \d/)
  })

  it('seals sessions to the run\'s public key, so nothing readable reaches the logs', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    lines.length = 0
    await accounts().sessions(publicKey.export({ type: 'spki', format: 'pem' }).toString())
    const parts = lines.filter((line) => line.startsWith('LOAD_TEST_SESSIONS_SEALED_PART '))
    expect(parts.length).toBeGreaterThan(0)
    const sealed = parts.map((line) => line.split(' ')[2]).join('')
    expect(lines.join('\n')).not.toMatch(/access-|refresh-|loadtest-/)
    const [wrapped, iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64'))
    const key = privateDecrypt({ key: privateKey, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrapped!)
    const decipher = createDecipheriv('aes-256-gcm', key, iv!)
    decipher.setAuthTag(tag!)
    const sessions = JSON.parse(Buffer.concat([decipher.update(body!), decipher.final()]).toString('utf8'))
    expect(sessions).toHaveLength(LOAD_TEST_ACCOUNT_COUNT)
    expect(sessions[0]).toEqual({ index: 1, accessToken: `access-${loadTestEmail(1)}`, refreshToken: `refresh-${loadTestEmail(1)}` })
    await accounts().signOut()
    expect(users.get(loadTestEmail(50))!.signedOut).toBe(1)
  })

  it('refuses to delete when a flagged profile is not a test account, and otherwise deletes everything it made', async () => {
    const realRows = await db.query(`select id from public.profiles where not is_load_test limit 1`)
    await db.query(`update public.profiles set is_load_test = true where id = $1`, [realRows[0]!.id])
    await expect(accounts().remove()).rejects.toThrow('load_test_flag_on_real_account')
    await db.query(`update public.profiles set is_load_test = false where id = $1`, [realRows[0]!.id])
    lines.length = 0
    await accounts().remove()
    expect(await accounts().counts()).toEqual({ profiles: 0, communities: 0, follows: 0, mixedFollows: 0, posts: 0 })
    expect(users.size).toBe(0)
    expect(lines).toContain(`LOAD_TEST_ACCOUNTS_DELETED profiles=${LOAD_TEST_ACCOUNT_COUNT} cognito_users=${LOAD_TEST_ACCOUNT_COUNT} cognito_users_left=0`)
    const real = await db.query(`select count(*)::int as n from public.profiles where id = $1`, [realRows[0]!.id])
    expect(real[0]!.n).toBe(1)
  })

  it('reads the read-only action ids from the build manifest and refuses a build without them', async () => {
    const { actionIdsFromManifest } = await import('./accounts')
    const manifest = { node: {
      ['a'.repeat(42)]: { filename: 'src/features/feed/actions.ts', exportedName: 'loadTopFeedPage' },
      ['b'.repeat(42)]: { filename: 'src/features/notifications/actions.ts', exportedName: 'loadUnreadNotificationCount' },
      ['c'.repeat(42)]: { filename: 'src/features/feed/actions.ts', exportedName: 'setPostLiked' },
    } }
    expect(actionIdsFromManifest(manifest)).toEqual({ loadTopFeedPage: 'a'.repeat(42), loadUnreadNotificationCount: 'b'.repeat(42) })
    expect(() => actionIdsFromManifest({ node: {} })).toThrow('load_test_action_missing_loadTopFeedPage')
  })

  it('fails the clean-up when a Cognito user cannot be deleted', async () => {
    await accounts().create()
    const stuck = createLoadTestAccounts({ ...depsWithStuckDelete() })
    await expect(stuck.remove()).rejects.toThrow('load_test_delete_incomplete')
    users.clear()
    await db.query(`delete from public.community_groups where is_load_test`)
    await db.query(`delete from public.profiles where is_load_test`)
  })
})

function depsWithStuckDelete() {
  const base = accountsDeps()
  return { ...base, cognito: { ...base.cognito, deleteUser: async () => undefined } }
}
