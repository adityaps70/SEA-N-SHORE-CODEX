// Round ARCH (Phase 1): the load-test accounts, run as a one-off ECS task from the deployed web image by
// scripts/aws/load-test-accounts.sh (plan / create-once / delete-once) and .github/workflows/aws-load-test.yml
// (sessions / sign-out). See src/features/load-test/accounts.ts. Prints counts and statuses only.
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider'
import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction } from '../../src/lib/db/client'
import { provisionProfileForCognitoPrincipal } from '../../src/features/auth/identity-repository'
import { createOnboardingService } from '../../src/features/profiles/onboarding-service'
import { createOnboardingRepositoryForClient } from '../../src/features/profiles/onboarding-repository'
import { readFileSync } from 'node:fs'
import { actionIdsFromManifest, createLoadTestAccounts } from '../../src/features/load-test/accounts'

const mode = process.env.LOAD_TEST_ACCOUNTS_MODE ?? 'plan'
const poolId = process.env.AWS_COGNITO_USER_POOL_ID ?? ''
const clientId = process.env.AWS_COGNITO_CLIENT_ID ?? ''
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? 'ap-south-1' })

const onboarding = createOnboardingService({
  withTransaction: (fn) => withTransaction((client) => fn(createOnboardingRepositoryForClient(client))),
})

const accounts = createLoadTestAccounts({
  query: async (text, values) => (await databaseQuery<QueryResultRow>(text, values)) as Array<Record<string, unknown>>,
  transaction: (work) => withTransaction((client) => work(async (text, values) => (await client.query(text, values)).rows as Array<Record<string, unknown>>)),
  cognito: {
    async findUserSub(email) {
      try {
        const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: email }))
        return user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value ?? null
      } catch (error) {
        if (error instanceof UserNotFoundException) return null
        throw error
      }
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
  readActionIds: async () => actionIdsFromManifest(JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8'))),
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
