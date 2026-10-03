'use server'

import { cookies } from 'next/headers'
import { redirect as nextRedirect } from 'next/navigation'
import { createCognitoApi } from '@/lib/auth/cognito-api'
import { createCognitoLogoutUrl } from '@/lib/auth/cognito-oauth'
import { AFTER_SIGN_OUT_COOKIE, AFTER_SIGN_OUT_COOKIE_MAX_AGE_SECONDS } from '@/lib/auth/after-sign-out'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { createAuthActionHandlers, type AuthActionState } from './action-handlers'
import { createCognitoAuthActions } from './cognito-actions'
import { createPhoneAuthActions, type PhoneAuthActionState } from './phone-auth-actions'
import { createPhoneAuthAdmin } from './phone-auth-admin'
import { createPhoneAuthActionHandlers } from './phone-action-handlers'

export type { AuthActionState } from './action-handlers'

type CognitoActions = ReturnType<typeof createCognitoAuthActions>

async function getProductionActions(): Promise<CognitoActions> {
  const cookieStore = await cookies()
  const environment = getCognitoEnvironment()
  const api = createCognitoApi({
    region: environment.AWS_COGNITO_REGION,
    clientId: environment.AWS_COGNITO_CLIENT_ID,
  })

  return createCognitoAuthActions({
    api,
    cookieStore: cookieStore as unknown as Parameters<typeof createCognitoAuthActions>[0]['cookieStore'],
    siteUrl: publicEnvironment.NEXT_PUBLIC_SITE_URL,
    allowInsecureHttpCookies: environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES,
  })
}

const handlers = createAuthActionHandlers({
  getActions: getProductionActions,
  redirect: nextRedirect,
  getSignOutDestination: () => {
    const environment = getCognitoEnvironment()
    if (!environment.AWS_COGNITO_DOMAIN) return '/'
    return createCognitoLogoutUrl({
      domain: environment.AWS_COGNITO_DOMAIN,
      clientId: environment.AWS_COGNITO_CLIENT_ID,
      siteUrl: publicEnvironment.NEXT_PUBLIC_SITE_URL,
    })
  },
})

async function getProductionPhoneActions() {
  const cookieStore = await cookies()
  const environment = getCognitoEnvironment()
  const api = createCognitoApi({
    region: environment.AWS_COGNITO_REGION,
    clientId: environment.AWS_COGNITO_CLIENT_ID,
  })
  const admin = createPhoneAuthAdmin({
    userPoolId: environment.AWS_COGNITO_USER_POOL_ID,
    region: environment.AWS_COGNITO_REGION,
  })

  return createPhoneAuthActions({
    api,
    admin,
    cookieStore: cookieStore as unknown as Parameters<typeof createPhoneAuthActions>[0]['cookieStore'],
    siteUrl: publicEnvironment.NEXT_PUBLIC_SITE_URL,
    allowInsecureHttpCookies: environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES,
  })
}

const phoneHandlers = createPhoneAuthActionHandlers({
  getActions: getProductionPhoneActions,
  redirect: nextRedirect,
})

export async function signIn(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  return handlers.signIn(state, formData)
}

export async function signUp(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  return handlers.signUp(state, formData)
}

export async function confirmSignUp(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  return handlers.confirmSignUp(state, formData)
}

export async function resendConfirmationCode(formData: FormData): Promise<void> {
  const actions = await getProductionActions()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const result = await actions.resendConfirmationCode({}, formData)
  const params = new URLSearchParams({ confirm: '1', email })
  if (result.message === 'Confirmation code sent.') params.set('resent', '1')
  else params.set('resendError', '1')
  nextRedirect(`/auth/sign-up?${params.toString()}`)
}

export async function requestPasswordReset(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  return handlers.requestPasswordReset(state, formData)
}

export async function updatePassword(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  return handlers.updatePassword(state, formData)
}

export async function signOut(): Promise<void> {
  return handlers.signOut()
}

/**
 * Onboarding's "Not you? Use a different email": signs out like `signOut`, then the proxy sends
 * the site root (Cognito's only allowed logout return) on to sign-up.
 */
export async function signOutToSignUp(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(AFTER_SIGN_OUT_COOKIE, '/auth/sign-up', {
    httpOnly: true,
    sameSite: 'lax',
    secure: !getCognitoEnvironment().AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES,
    path: '/',
    maxAge: AFTER_SIGN_OUT_COOKIE_MAX_AGE_SECONDS,
  })
  return handlers.signOut()
}


export async function requestPhoneOtp(
  state: PhoneAuthActionState,
  formData: FormData,
): Promise<PhoneAuthActionState> {
  return phoneHandlers.requestOtp(state, formData)
}

export async function confirmPhoneOtp(
  state: PhoneAuthActionState,
  formData: FormData,
): Promise<PhoneAuthActionState> {
  return phoneHandlers.confirmOtp(state, formData)
}
