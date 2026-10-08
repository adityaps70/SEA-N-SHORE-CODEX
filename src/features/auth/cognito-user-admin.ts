import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { getCognitoEnvironment } from '@/lib/env'

type CognitoAdminClient = Pick<CognitoIdentityProviderClient, 'send'>

/**
 * Server-side Cognito user removal for account deletion: a member's other sign-ins (e.g. a
 * second email or Google login linked to the same profile) and Google-federated users, whose
 * tokens carry no self-service delete scope. Replaces the old phone-auth admin (Round 15:
 * mobile-number sign-in and SMS are retired).
 */
export function createCognitoUserAdmin(input: {
  client?: CognitoAdminClient
  userPoolId?: string
  region?: string
} = {}) {
  const environment = input.userPoolId && input.region ? null : getCognitoEnvironment()
  const userPoolId = input.userPoolId ?? environment?.AWS_COGNITO_USER_POOL_ID
  const region = input.region ?? environment?.AWS_COGNITO_REGION
  if (!userPoolId || !region) throw new Error('cognito_admin_environment_unavailable')

  const client = input.client ?? new CognitoIdentityProviderClient({ region })

  return {
    /** Removes a Cognito user. Already gone counts as done. */
    async deleteUser(username: string): Promise<void> {
      try {
        await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }))
      } catch (error) {
        if (error instanceof Error && error.name === 'UserNotFoundException') return
        throw error
      }
    },
  }
}
