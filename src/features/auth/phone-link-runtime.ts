import { cookies } from 'next/headers'
import { createCognitoApi } from '@/lib/auth/cognito-api'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { AwsAuthenticationRequiredError, requireAwsUser } from './aws-queries'
import { createPhoneAuthAdmin } from './phone-auth-admin'
import { createPhoneLinkService } from './phone-link'
import { phoneLinkRepository } from './phone-link-repository'

export async function runtimePhoneLinkService() {
  const cookieStore = await cookies()
  const environment = getCognitoEnvironment()
  return createPhoneLinkService({
    api: createCognitoApi({ region: environment.AWS_COGNITO_REGION, clientId: environment.AWS_COGNITO_CLIENT_ID }),
    admin: createPhoneAuthAdmin({ userPoolId: environment.AWS_COGNITO_USER_POOL_ID, region: environment.AWS_COGNITO_REGION }),
    repository: phoneLinkRepository,
    cookieStore: cookieStore as unknown as Parameters<typeof createPhoneLinkService>[0]['cookieStore'],
    siteUrl: publicEnvironment.NEXT_PUBLIC_SITE_URL,
    allowInsecureHttpCookies: environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES,
  })
}

export async function signedInPhoneLinkMember() {
  try {
    const user = await requireAwsUser()
    return { id: user.id, cognitoSub: user.cognitoSub }
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return null
    throw error
  }
}

/** Mobile numbers on the signed-in account, for the Settings page. Null when signed out or unavailable. */
export async function getAccountPhoneSummary() {
  const member = await signedInPhoneLinkMember()
  if (!member) return null
  try {
    return await (await runtimePhoneLinkService()).getSummary(member)
  } catch (error) {
    console.error('phone_link_summary_failed', { name: error instanceof Error ? error.name : null })
    return null
  }
}
