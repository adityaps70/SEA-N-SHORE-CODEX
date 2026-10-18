import {
  AdminDeleteUserCommand,
  AdminSetUserMFAPreferenceCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
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

    /**
     * Round H (H3): turns the authenticator app (TOTP) off for a member who signed in with a 2FA backup code.
     * Needs cognito-idp:AdminSetUserMFAPreference on the user pool (infra/aws/app/auth.tf, ecs_task_cognito_admin).
     */
    async disableSoftwareTokenMfa(username: string): Promise<void> {
      await client.send(new AdminSetUserMFAPreferenceCommand({
        UserPoolId: userPoolId,
        Username: username,
        SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
      }))
    },

    /** Round H (H3): the sub of a Cognito username (ListUsers, already allowed for the web task), or null. */
    async findSubByUsername(username: string): Promise<string | null> {
      if (!/^[\w.@+-]{1,128}$/.test(username)) return null
      const response = await client.send(new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `username = "${username}"`,
        Limit: 1,
        AttributesToGet: ['sub'],
      }))
      const user = response.Users?.[0]
      if (!user || user.Username !== username) return null
      return user.Attributes?.find((attribute) => attribute.Name === 'sub')?.Value ?? null
    },
  }
}
