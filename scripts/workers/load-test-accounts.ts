// Round ARCH (Phase 1): the load-test accounts, run as a one-off ECS task from the deployed web image by
// scripts/aws/load-test-accounts.sh (plan / create-once / delete-once) and .github/workflows/aws-load-test.yml
// (sessions / sign-out). See src/features/load-test/accounts.ts. Prints counts and statuses only.
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction } from '../../src/lib/db/client'
import { provisionProfileForCognitoPrincipal } from '../../src/features/auth/identity-repository'
import { peopleSuggestions } from '../../src/features/ranking/people-suggestions'
import { createOnboardingService } from '../../src/features/profiles/onboarding-service'
import { createOnboardingRepositoryForClient } from '../../src/features/profiles/onboarding-repository'
import { readFileSync } from 'node:fs'
import { actionIdsFromManifest, createLoadTestAccounts } from '../../src/features/load-test/accounts'

const mode = process.env.LOAD_TEST_ACCOUNTS_MODE ?? 'plan'
const poolId = process.env.AWS_COGNITO_USER_POOL_ID ?? ''
const clientId = process.env.AWS_COGNITO_CLIENT_ID ?? ''
// Adaptive retries back off when Cognito throttles (run 44328902760), on top of the worker's own spacing.
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1', retryMode: 'adaptive', maxAttempts: 8 })
// The sessions hand-off (infra/aws/app/load-test-handoff.tf): one object per run under sessions/. No encryption
// header: the bucket refuses one, and its default (the hand-off KMS key) applies. IfNoneMatch: never overwrite.
const HANDOFF_BUCKET = 'sea-n-shore-staging-310356785722-load-test-handoff'
const handoffKey = process.env.LOAD_TEST_SESSIONS_OBJECT_KEY ?? ''
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' })

const onboarding = createOnboardingService({
  withTransaction: (fn) => withTransaction((client) => fn(createOnboardingRepositoryForClient(client))),
})

const accounts = createLoadTestAccounts({
  query: async (text, values) => (await databaseQuery<QueryResultRow>(text, values)) as Array<Record<string, unknown>>,
  transaction: (work) => withTransaction((client) => work(async (text, values) => (await client.query(text, values)).rows as Array<Record<string, unknown>>)),
  cognito: {
    // ListUsers, not AdminGetUser: the web task role may list users but not get one (the role's Cognito actions are
    // pinned by scripts/aws/account-security-infra.test.mjs). One paged listing by email prefix (60 a page, about 17
    // pages for 1,000) instead of a lookup per account, which hit Cognito's request rate in run 44328902760. Pages are
    // spaced; only the reserved .invalid test addresses are used from it (accounts.ts).
    async listLoadTestUsers() {
      const users = new Map<string, string>()
      let token: string | undefined
      do {
        const page = await cognito.send(new ListUsersCommand({ UserPoolId: poolId, Filter: 'email ^= "loadtest-"', Limit: 60, PaginationToken: token }))
        for (const user of page.Users ?? []) {
          const email = user.Attributes?.find((attribute) => attribute.Name === 'email')?.Value?.toLowerCase()
          const sub = user.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value
          if (!email || !sub) continue
          if (users.has(email)) throw new Error('load_test_user_not_unique')
          users.set(email, sub)
        }
        token = page.PaginationToken
        if (token) await new Promise((resolve) => setTimeout(resolve, 200))
      } while (token)
      return users
    },
    async createUser(email, name) {
      const created = await cognito.send(new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }, { Name: 'name', Value: name }],
      }))
      const sub = created.User?.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value
      if (!sub) throw new Error('load_test_user_without_sub')
      return sub
    },
    async setPassword(email, password) {
      await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username: email, Password: password, Permanent: true }))
    },
    async signIn(email, password) {
      const result = await cognito.send(new InitiateAuthCommand({ ClientId: clientId, AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email, PASSWORD: password } }))
      const accessToken = result.AuthenticationResult?.AccessToken
      if (!accessToken) throw new Error(`load_test_sign_in_${result.ChallengeName ?? 'failed'}`.toLowerCase())
      return { accessToken, refreshToken: result.AuthenticationResult?.RefreshToken ?? null }
    },
    async deleteUser(email) {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: email }))
    },
    async globalSignOut(email) {
      await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: poolId, Username: email }))
    },
  },
  provisionProfile: provisionProfileForCognitoPrincipal,
  completeActivation: (profileId, input) => onboarding.completeActivation(profileId, input),
  refreshPeopleSuggestions: (profileId) => peopleSuggestions.refreshForViewer(profileId),
  readActionIds: async () => actionIdsFromManifest(JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8'))),
  storeSealed: async (sealed) => {
    if (!/^sessions\/[0-9]{6,20}-[0-9]{1,3}\.sealed$/.test(handoffKey)) throw new Error('load_test_handoff_key_invalid')
    await s3.send(new PutObjectCommand({ Bucket: HANDOFF_BUCKET, Key: handoffKey, Body: sealed, ContentType: 'application/octet-stream', IfNoneMatch: '*' }))
  },
  log: (line) => console.info(line),
})

async function main() {
  if (!poolId || !clientId) throw new Error('cognito_configuration_missing')
  if (mode === 'plan') await accounts.plan()
  else if (mode === 'create-once') await accounts.create()
  else if (mode === 'delete-once') await accounts.remove()
  else if (mode === 'sessions') {
    const publicKey = Buffer.from(process.env.LOAD_TEST_SESSIONS_PUBLIC_KEY ?? '', 'base64').toString('utf8')
    if (!publicKey.includes('BEGIN PUBLIC KEY')) throw new Error('load_test_public_key_missing')
    await accounts.sessions(publicKey)
  } else if (mode === 'sign-out') await accounts.signOut()
  else throw new Error(`Unsupported mode: ${mode}`)
}

main().then(() => process.exit(0), (error: unknown) => {
  console.error('LOAD_TEST_ACCOUNTS_FAILED', error instanceof Error ? error.message : 'unknown_error')
  process.exit(1)
})
