'use server'

import { cookies } from 'next/headers'
import { redirect as nextRedirect } from 'next/navigation'
import { createCognitoApi } from '@/lib/auth/cognito-api'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { createAuthActionHandlers, type AuthActionState } from './action-handlers'
import { createCognitoAuthActions } from './cognito-actions'

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

export async function requestPasswordReset(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  return handlers.requestPasswordReset(state, formData)
}

export async function updatePassword(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  return handlers.updatePassword(state, formData)
}

export async function signOut(): Promise<void> {
  return handlers.signOut()
}
