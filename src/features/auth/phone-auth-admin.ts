import { createHash, randomBytes } from 'node:crypto'
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { getCognitoEnvironment } from '@/lib/env'

type CognitoAdminClient = Pick<CognitoIdentityProviderClient, 'send'>

function defaultRandomPassword() {
  return `${randomBytes(32).toString('base64url')}Aa1!`
}

function defaultSyntheticEmailForPhone(phoneNumber: string) {
  const digest = createHash('sha256').update(phoneNumber).digest('hex').slice(0, 32)
  return `phone-${digest}@auth.seaandshore.in`
}

function attributeValue(
  attributes: Array<{ Name?: string; Value?: string }> | undefined,
  name: string,
) {
  return attributes?.find((attribute) => attribute.Name === name)?.Value ?? null
}

export function createPhoneAuthAdmin(input: {
  client?: CognitoAdminClient
  userPoolId?: string
  region?: string
  randomPassword?: () => string
  syntheticEmailForPhone?: (phoneNumber: string) => string
} = {}) {
  const environment = input.userPoolId && input.region ? null : getCognitoEnvironment()
  const userPoolId = input.userPoolId ?? environment?.AWS_COGNITO_USER_POOL_ID
  const region = input.region ?? environment?.AWS_COGNITO_REGION
  if (!userPoolId || !region) throw new Error('phone_auth_environment_unavailable')

  const client = input.client ?? new CognitoIdentityProviderClient({ region })
  const randomPassword = input.randomPassword ?? defaultRandomPassword
  const syntheticEmailForPhone = input.syntheticEmailForPhone ?? defaultSyntheticEmailForPhone

  return {
    async findVerifiedUserByPhone(phoneNumber: string): Promise<{ username: string } | null> {
      const response = await client.send(new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `phone_number = "${phoneNumber.replace(/["\\]/g, '')}"`,
        Limit: 2,
      }))

      const verified = (response.Users ?? []).filter((user) =>
        Boolean(user.Username)
        && attributeValue(user.Attributes, 'phone_number') === phoneNumber
        && attributeValue(user.Attributes, 'phone_number_verified') === 'true',
      )

      if (verified.length > 1) throw new Error('phone_identity_ambiguous')
      const username = verified[0]?.Username
      return username ? { username } : null
    },

    async createPhoneUser(inputUser: {
      phoneNumber: string
      fullName: string
    }): Promise<{ username: string }> {
      const syntheticEmail = syntheticEmailForPhone(inputUser.phoneNumber)
      const response = await client.send(new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: syntheticEmail,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'name', Value: inputUser.fullName },
          { Name: 'phone_number', Value: inputUser.phoneNumber },
        ],
      }))

      const username = response.User?.Username
      if (!username) throw new Error('phone_user_creation_failed')

      await client.send(new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: username,
        Password: randomPassword(),
        Permanent: true,
      }))

      return { username }
    },

    async markPhoneVerified(username: string): Promise<void> {
      await client.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: username,
        UserAttributes: [{ Name: 'phone_number_verified', Value: 'true' }],
      }))
    },
  }
}
