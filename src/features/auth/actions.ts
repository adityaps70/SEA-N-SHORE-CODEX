'use server'

import { cookies } from 'next/headers'
import { redirect as nextRedirect } from 'next/navigation'
import { createCognitoApi } from '@/lib/auth/cognito-api'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { getOnboardingProfileFromAurora } from '@/features/profiles/onboarding-repository'
import { requireAwsUser } from './aws-queries'
import {
  createCognitoAuthActions,
  type CognitoAuthActionState,
} from './cognito-actions'

export type AuthActionState = CognitoAuthActionState

type CognitoActions = ReturnType<typeof createCognitoAuthActions>
type Redirect = (path: string) => void

type ProfileProgress = { onboardingCompletedAt: string | null }

export function createAuthActionHandlers(input: {
  getActions: () => Promise<CognitoActions>
  getProfileProgress: () => Promise<ProfileProgress>
  redirect: Redirect
}) {
  async function routeAuthenticatedUser() {
    const profile = await input.getProfileProgress()
    input.redirect(profile.onboardingCompletedAt ? '/home' : '/onboarding')
  }

  return {
    async signIn(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
      const actions = await input.getActions()
      const result = await actions.signIn(state, formData)
      if (result.next === 'new-password') {
        input.redirect('/auth/update-password?mode=new-password')
        return result
      }
      if (result.message === 'Signed in.') await routeAuthenticatedUser()
      return result
    },

    async signUp(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
      const actions = await input.getActions()
      const result = await actions.signUp(state, formData)
      if (result.message === 'Check your email to continue.') {
        const email = String(formData.get('email') ?? '').trim().toLowerCase()
        input.redirect(`/auth/sign-up?confirm=1&email=${encodeURIComponent(email)}`)
      }
      return result
    },

    async confirmSignUp(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
      const actions = await input.getActions()
      const result = await actions.confirmSignUp(state, formData)
      if (result.message === 'Email confirmed.') input.redirect('/auth/sign-in')
      return result
    },

    async requestPasswordReset(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
      const actions = await input.getActions()
      const result = await actions.requestPasswordReset(state, formData)
      if (result.next === 'confirm-reset') {
        const email = String(formData.get('email') ?? '').trim().toLowerCase()
        input.redirect(`/auth/update-password?mode=confirm-reset&email=${encodeURIComponent(email)}`)
      }
      return result
    },

    async updatePassword(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
      const actions = await input.getActions()
      const mode = formData.get('mode')
      if (mode === 'new-password') {
        const result = await actions.completeNewPassword(state, formData)
        if (result.message === 'Password updated.') await routeAuthenticatedUser()
        return result
      }

      const result = await actions.confirmPasswordReset(state, formData)
      if (result.message === 'Password updated. You can sign in now.') input.redirect('/auth/sign-in')
      return result
    },

    async signOut() {
      const actions = await input.getActions()
      await actions.signOut()
      input.redirect('/')
    },
  }
}

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
  })
}

async function getProfileProgress(): Promise<ProfileProgress> {
  const user = await requireAwsUser()
  const profile = await getOnboardingProfileFromAurora(user.id)
  if (!profile) throw new Error('Unable to load profile progress.')
  return { onboardingCompletedAt: profile.onboardingCompletedAt }
}

const handlers = createAuthActionHandlers({
  getActions: getProductionActions,
  getProfileProgress,
  redirect: nextRedirect,
})

export const signIn = handlers.signIn
export const signUp = handlers.signUp
export const confirmSignUp = handlers.confirmSignUp
export const requestPasswordReset = handlers.requestPasswordReset
export const updatePassword = handlers.updatePassword
export const signOut = handlers.signOut
