import { createCipheriv, publicEncrypt, randomBytes, constants as cryptoConstants } from 'node:crypto'
import type { CognitoPrincipal } from '@/lib/auth/cognito-api'
import { onboardingActivationSchema, type OnboardingActivationInput } from '@/features/profiles/schemas'

/**
 * Round ARCH (Phase 1): the load-test accounts (1,000 since 18 Nov, one per simulated member: the WAF limits each
 * session to 1,000 requests per 5 minutes). Each is a Cognito user on a reserved .invalid address (never emailed;
 * Cognito sends nothing because creation suppresses the welcome message), with an onboarded profile flagged
 * is_load_test. Each follows the next 49 (as many as each of the first 50 did), all belong to one hidden private
 * community (is_load_test) and share one test post there. The app keeps them away from real members
 * (src/features/load-test/load-test-sql.ts). Cognito and the database are called at most
 * LOAD_TEST_ACCOUNT_CONCURRENCY at a time, so 1,000 accounts stay inside Cognito's request rates and the host's time.
 *
 * Modes (scripts/workers/load-test-accounts.ts):
 *   plan         counts only;
 *   create-once  creates what is missing (safe to repeat);
 *   delete-once  deletes every flagged account, the community and their Cognito users, and refuses anything unflagged;
 *   sessions     sets a fresh random password per account, signs each in, seals the sessions to the run's public
 *                key and stores them as one S3 object for the runner (infra/aws/app/load-test-handoff.tf); the log
 *                gets counts only;
 *   sign-out     ends every test account's sessions (Cognito global sign-out) after a run.
 * Every line printed is a count or a status: no email, name, password or token.
 */

export const LOAD_TEST_ACCOUNT_COUNT = 1000
/** How many of the next accounts each one follows (each of the first 50 followed the other 49). */
export const LOAD_TEST_FOLLOWS_PER_ACCOUNT = 49
/** At most this many Cognito or database calls at once (ListUsers allows about 30 a second). */
export const LOAD_TEST_ACCOUNT_CONCURRENCY = 4
export const LOAD_TEST_EMAIL_DOMAIN = 'loadtest.seanshore.invalid'
export const LOAD_TEST_COMMUNITY_SLUG = 'sns-load-test-hidden'
const EMAIL_PATTERN = /^loadtest-(\d{4})@loadtest\.seanshore\.invalid$/

/** The account's number, four digits (0001-1000). */
export function loadTestNumber(index: number) {
  if (!Number.isInteger(index) || index < 1 || index > LOAD_TEST_ACCOUNT_COUNT) throw new Error('load_test_index_invalid')
  return String(index).padStart(4, '0')
}

export function loadTestEmail(index: number) {
  return `loadtest-${loadTestNumber(index)}@${LOAD_TEST_EMAIL_DOMAIN}`
}

/** Runs `work` over `items`, at most `limit` at a time, and returns the results in the items' order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const position = next
      next += 1
      results[position] = await work(items[position]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export function isLoadTestEmail(email: string | null | undefined) {
  const match = EMAIL_PATTERN.exec((email ?? '').toLowerCase())
  return Boolean(match) && Number(match![1]) >= 1 && Number(match![1]) <= LOAD_TEST_ACCOUNT_COUNT
}

/** The onboarding answers every test account gets: a plain maritime enthusiast, nothing that reaches real members. */
export function loadTestActivation(index: number): OnboardingActivationInput {
  const number = loadTestNumber(index)
  return onboardingActivationSchema.parse({
    persona: 'maritime_enthusiast',
    profileIntents: ['network'],
    fullName: `Load Test ${number}`,
    slug: `sns-load-test-${number}`,
  }) as OnboardingActivationInput
}

/** A password Cognito's policy accepts (upper, lower, digit, symbol), 32+ random characters. */
export function randomLoadTestPassword() {
  return `Lt-${randomBytes(24).toString('base64url')}9a!Z`
}

export type LoadTestSession = { index: number; accessToken: string; refreshToken: string | null }

/**
 * The sessions bundle as stored: AES-256-GCM over the JSON, the AES key wrapped with RSA-OAEP-SHA256 to the run's
 * public key. Only the runner that generated the key pair can read it.
 */
export function encryptSessions(sessions: LoadTestSession[], publicKeyPem: string) {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(sessions), 'utf8'), cipher.final()])
  const wrapped = publicEncrypt({ key: publicKeyPem, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key)
  return [wrapped, iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.')
}

type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export type LoadTestAccountDeps = {
  query: Query
  transaction: <T>(work: (query: Query) => Promise<T>) => Promise<T>
  cognito: {
    findUserSub(email: string): Promise<string | null>
    createUser(email: string, name: string): Promise<string>
    setPassword(email: string, password: string): Promise<void>
    signIn(email: string, password: string): Promise<{ accessToken: string; refreshToken: string | null }>
    deleteUser(email: string): Promise<void>
    globalSignOut(email: string): Promise<void>
  }
  provisionProfile(principal: CognitoPrincipal): Promise<string>
  completeActivation(profileId: string, input: OnboardingActivationInput): Promise<unknown>
  randomPassword?: () => string
  /** The deployed build's ids for the read-only server actions the signed-in load test calls (not secret). */
  readActionIds?: () => Promise<Record<string, string>>
  /**
   * Stores the sealed sessions as the run's one hand-off object (S3, SSE-KMS; the task may only write it). Run
   * 42486602879 and the 9 Nov run: a log of about 200 KB printed at exit never fully reached CloudWatch.
   */
  storeSealed?: (sealed: string) => Promise<void>
  /** Tests only: fewer accounts than LOAD_TEST_ACCOUNT_COUNT (the real worker never sets it). */
  accountCount?: number
  log(line: string): void
}

/** The read-only server actions the signed-in mix calls, by file and export name. */
export const LOAD_TEST_ACTIONS = {
  loadTopFeedPage: 'src/features/feed/actions.ts',
  loadUnreadNotificationCount: 'src/features/notifications/actions.ts',
} as const

/** Picks those actions' ids from the build's server-reference manifest (.next/server/server-reference-manifest.json). */
export function actionIdsFromManifest(manifest: { node?: Record<string, { filename?: string; exportedName?: string }> }) {
  const ids: Record<string, string> = {}
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    const name = entry.exportedName as keyof typeof LOAD_TEST_ACTIONS | undefined
    if (name && LOAD_TEST_ACTIONS[name] === entry.filename && /^[0-9a-f]{40,44}$/.test(id)) ids[name] = id
  }
  for (const name of Object.keys(LOAD_TEST_ACTIONS)) if (!ids[name]) throw new Error(`load_test_action_missing_${name}`)
  return ids
}

export function createLoadTestAccounts(deps: LoadTestAccountDeps) {
  const accountCount = deps.accountCount ?? LOAD_TEST_ACCOUNT_COUNT
  if (!Number.isInteger(accountCount) || accountCount < 2 || accountCount > LOAD_TEST_ACCOUNT_COUNT) throw new Error('load_test_account_count_invalid')
  const indexes = Array.from({ length: accountCount }, (_, i) => i + 1)
  /** Whether each index's address has a Cognito user, LOAD_TEST_ACCOUNT_CONCURRENCY lookups at a time. */
  const cognitoUserCount = async () =>
    (await mapLimit(indexes, LOAD_TEST_ACCOUNT_CONCURRENCY, async (index) => Boolean(await deps.cognito.findUserSub(loadTestEmail(index))))).filter(Boolean).length

  async function flaggedProfiles() {
    const rows = await deps.query(
      `select p.id, ia.email from public.profiles p
       left join public.identity_accounts ia on ia.profile_id = p.id and ia.provider = 'cognito'
       where p.is_load_test order by ia.email nulls first`,
    )
    return rows.map((row) => ({ id: String(row.id), email: String(row.email ?? '') }))
  }

  async function counts() {
    const [row] = await deps.query(
      `select
         (select count(*) from public.profiles where is_load_test)::int as profiles,
         (select count(*) from public.community_groups where is_load_test)::int as communities,
         (select count(*) from public.follows f join public.profiles a on a.id = f.follower_id and a.is_load_test
            join public.profiles b on b.id = f.following_id and b.is_load_test)::int as follows,
         (select count(*) from public.follows f join public.profiles a on a.id = f.follower_id
            join public.profiles b on b.id = f.following_id where a.is_load_test <> b.is_load_test)::int as mixed_follows,
         (select count(*) from public.posts p join public.profiles a on a.id = p.author_id and a.is_load_test
            where p.deleted_at is null)::int as posts`,
    )
    return {
      profiles: Number(row?.profiles ?? 0), communities: Number(row?.communities ?? 0), follows: Number(row?.follows ?? 0),
      mixedFollows: Number(row?.mixed_follows ?? 0), posts: Number(row?.posts ?? 0),
    }
  }

  function report(label: string, value: Awaited<ReturnType<typeof counts>>) {
    deps.log(`LOAD_TEST_ACCOUNTS_${label} profiles=${value.profiles} communities=${value.communities} follows=${value.follows} mixed_follows=${value.mixedFollows} posts=${value.posts}`)
  }

  async function plan() {
    const cognitoUsers = await cognitoUserCount()
    deps.log(`LOAD_TEST_ACCOUNTS_COGNITO_USERS count=${cognitoUsers} of=${accountCount}`)
    report('PLAN', await counts())
    deps.log('LOAD_TEST_ACCOUNTS_PLAN_VERIFIED=true')
  }

  async function create() {
    // In index order: account 1 owns the community, and each follows the next LOAD_TEST_FOLLOWS_PER_ACCOUNT.
    const profileIds = await mapLimit(indexes, LOAD_TEST_ACCOUNT_CONCURRENCY, async (index) => {
      const email = loadTestEmail(index)
      const activation = loadTestActivation(index)
      const sub = (await deps.cognito.findUserSub(email)) ?? (await deps.cognito.createUser(email, activation.fullName))
      const profileId = await deps.provisionProfile({ sub, email, emailVerified: true, name: activation.fullName })
      const [profile] = await deps.query(
        `select p.is_load_test, p.onboarding_completed_at is not null as onboarded, ia.email
         from public.profiles p join public.identity_accounts ia on ia.profile_id = p.id and ia.provider = 'cognito' and ia.provider_subject = $2
         where p.id = $1`,
        [profileId, sub],
      )
      // Refuse to touch any profile that is not this test account's own (it could only be a mapping mistake).
      if (!profile || !isLoadTestEmail(String(profile.email ?? ''))) throw new Error('load_test_profile_mismatch')
      if (!profile.is_load_test && profile.onboarded) throw new Error('load_test_profile_not_new')
      await deps.query(`update public.profiles set is_load_test = true where id = $1`, [profileId])
      if (!profile.onboarded) await deps.completeActivation(profileId, activation)
      return profileId
    })
    const followsEach = Math.min(LOAD_TEST_FOLLOWS_PER_ACCOUNT, accountCount - 1)
    await deps.transaction(async (query) => {
      // A ring: account n follows n+1 ... n+followsEach (wrapping), so every account has the same few follows.
      await query(
        `insert into public.follows (follower_id, following_id)
         select a.id, b.id from unnest($1::uuid[]) with ordinality a(id, n)
         join unnest($1::uuid[]) with ordinality b(id, m) on (b.m - a.n + $2) % $2 between 1 and $3
         on conflict do nothing`,
        [profileIds, accountCount, followsEach],
      )
      const [group] = await query(
        `insert into public.community_groups (name, slug, visibility, description, created_by, is_load_test)
         values ('Sea N Shore load test', $1, 'private', 'Hidden community for the repeatable load test.', $2, true)
         on conflict (slug) do update set is_load_test = true
         returning id, is_load_test`,
        [LOAD_TEST_COMMUNITY_SLUG, profileIds[0]],
      )
      if (!group?.is_load_test) throw new Error('load_test_community_not_flagged')
      await query(
        `insert into public.community_group_memberships (group_id, profile_id, role, status)
         select $1, member, case when member = $2 then 'owner' else 'member' end, 'active' from unnest($3::uuid[]) member
         on conflict do nothing`,
        [group.id, profileIds[0], profileIds],
      )
      await query(
        `insert into public.posts (id, author_id, category, body, post_type, group_id, audience)
         select gen_random_uuid(), $2, 'technical_discussion', 'Load test post. It exists only for the repeatable load test.', 'standard', $1, 'members'
         where not exists (select 1 from public.posts where group_id = $1 and deleted_at is null)`,
        [group.id, profileIds[0]],
      )
    })
    const after = await counts()
    report('CREATED', after)
    if (after.profiles !== accountCount || after.follows < accountCount * followsEach || after.mixedFollows !== 0) throw new Error('load_test_create_incomplete')
    deps.log('LOAD_TEST_ACCOUNTS_CREATE_VERIFIED=true')
  }

  async function remove() {
    const profiles = await flaggedProfiles()
    if (profiles.some((profile) => !isLoadTestEmail(profile.email))) throw new Error('load_test_flag_on_real_account')
    await deps.transaction(async (query) => {
      await query(`delete from public.community_groups where is_load_test and slug = $1`, [LOAD_TEST_COMMUNITY_SLUG])
    })
    await mapLimit(profiles, LOAD_TEST_ACCOUNT_CONCURRENCY, async (profile) => {
      await deps.transaction(async (query) => {
        const rows = await query(`delete from public.profiles where id = $1 and is_load_test returning id`, [profile.id])
        if (rows.length !== 1) throw new Error('load_test_delete_refused')
      })
    })
    const deleted = profiles.length
    const cognitoDeleted = (await mapLimit(indexes, LOAD_TEST_ACCOUNT_CONCURRENCY, async (index) => {
      const email = loadTestEmail(index)
      if (!(await deps.cognito.findUserSub(email))) return false
      await deps.cognito.deleteUser(email)
      return true
    })).filter(Boolean).length
    // Cognito is checked again, address by address: the clean-up only passes when no test user is left there either.
    const cognitoLeft = await cognitoUserCount()
    deps.log(`LOAD_TEST_ACCOUNTS_DELETED profiles=${deleted} cognito_users=${cognitoDeleted} cognito_users_left=${cognitoLeft}`)
    const after = await counts()
    report('AFTER_DELETE', after)
    if (after.profiles !== 0 || after.communities !== 0 || cognitoLeft !== 0) throw new Error('load_test_delete_incomplete')
    deps.log('LOAD_TEST_ACCOUNTS_DELETE_VERIFIED=true')
  }

  async function sessions(publicKeyPem: string) {
    const randomPassword = deps.randomPassword ?? randomLoadTestPassword
    const flagged = new Set((await flaggedProfiles()).map((profile) => profile.email))
    for (const index of indexes) if (!flagged.has(loadTestEmail(index))) throw new Error('load_test_account_missing')
    const result: LoadTestSession[] = await mapLimit(indexes, LOAD_TEST_ACCOUNT_CONCURRENCY, async (index) => {
      const email = loadTestEmail(index)
      const password = randomPassword()
      await deps.cognito.setPassword(email, password)
      const tokens = await deps.cognito.signIn(email, password)
      return { index, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
    })
    deps.log(`LOAD_TEST_SESSIONS count=${result.length}`)
    if (!deps.storeSealed) throw new Error('load_test_handoff_missing')
    const sealed = encryptSessions(result, publicKeyPem)
    await deps.storeSealed(sealed)
    deps.log(`LOAD_TEST_SESSIONS_STORED count=${result.length} bytes=${Buffer.byteLength(sealed)}`)
    if (deps.readActionIds) deps.log(`LOAD_TEST_ACTIONS ${JSON.stringify(await deps.readActionIds())}`)
    deps.log('LOAD_TEST_SESSIONS_VERIFIED=true')
  }

  async function signOut() {
    const count = (await mapLimit(indexes, LOAD_TEST_ACCOUNT_CONCURRENCY, async (index) => {
      const email = loadTestEmail(index)
      if (!(await deps.cognito.findUserSub(email))) return false
      await deps.cognito.globalSignOut(email)
      return true
    })).filter(Boolean).length
    deps.log(`LOAD_TEST_SIGNED_OUT count=${count}`)
    deps.log('LOAD_TEST_SIGN_OUT_VERIFIED=true')
  }

  return { plan, create, remove, sessions, signOut, counts }
}
