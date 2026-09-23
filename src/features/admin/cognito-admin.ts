import {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { getCognitoEnvironment } from '@/lib/env'
import type { AdminIdentityControl } from './user-control-service'

type CognitoAdminClient = Pick<CognitoIdentityProviderClient, 'send'>

export function createAdminIdentityControl(input: {
  client?: CognitoAdminClient
  userPoolId?: string
  region?: string
} = {}): AdminIdentityControl {
  const environment = input.userPoolId && input.region ? null : getCognitoEnvironment()
  const userPoolId = input.userPoolId ?? environment?.AWS_COGNITO_USER_POOL_ID
  const region = input.region ?? environment?.AWS_COGNITO_REGION
  if (!userPoolId || !region) throw new Error('cognito_admin_environment_unavailable')
  const client = input.client ?? new CognitoIdentityProviderClient({ region })

  return {
    async disableUser(username: string) {
      await client.send(new AdminDisableUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      }))
    },

    async enableUser(username: string) {
      await client.send(new AdminEnableUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      }))
    },

    async deleteUser(username: string) {
      await client.send(new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: username,
      }))
    },

    async globalSignOut(username: string) {
      await client.send(new AdminUserGlobalSignOutCommand({
        UserPoolId: userPoolId,
        Username: username,
      }))
    },
  }
}

