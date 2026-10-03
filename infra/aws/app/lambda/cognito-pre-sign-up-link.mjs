import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider'

function attribute(user, name) {
  return user?.Attributes?.find((item) => item?.Name === name)?.Value
}

function googleSubject(userName) {
  if (typeof userName !== 'string' || !userName.startsWith('Google_')) return null
  const value = userName.slice('Google_'.length).trim()
  return value || null
}

function normalizedVerifiedEmail(event) {
  const email = event?.request?.userAttributes?.email
  const verified = event?.request?.userAttributes?.email_verified
  if (verified !== 'true' || typeof email !== 'string') return null
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/.test(normalized)) return null
  return normalized
}

function isEligibleLocalUser(user) {
  if (!user?.Username || user?.Enabled === false || user?.UserStatus === 'EXTERNAL_PROVIDER') return false
  return attribute(user, 'email_verified') === 'true'
}

function filterValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function createHandler(input = {}) {
  const client = input.client ?? new CognitoIdentityProviderClient({})

  return async function handler(event) {
    if (event?.triggerSource !== 'PreSignUp_ExternalProvider') return event

    const sourceSubject = googleSubject(event?.userName)
    const email = normalizedVerifiedEmail(event)
    const userPoolId = event?.userPoolId
    if (!sourceSubject || !email || typeof userPoolId !== 'string' || !userPoolId) return event

    const listed = await client.send(new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `email = "${filterValue(email)}"`,
      Limit: 10,
    }))

    const localUsers = (listed.Users ?? []).filter(isEligibleLocalUser)
    if (localUsers.length > 1) throw new Error('ambiguous_existing_account')
    if (localUsers.length === 0) return event

    await client.send(new AdminLinkProviderForUserCommand({
      UserPoolId: userPoolId,
      DestinationUser: {
        ProviderName: 'Cognito',
        ProviderAttributeValue: localUsers[0].Username,
      },
      SourceUser: {
        ProviderName: 'Google',
        ProviderAttributeName: 'Cognito_Subject',
        ProviderAttributeValue: sourceSubject,
      },
    }))

    return event
  }
}

export const handler = createHandler()
