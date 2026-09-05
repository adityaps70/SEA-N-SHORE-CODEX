import type { CognitoAuthActionState } from './cognito-actions'
import type { createCognitoAuthActions } from './cognito-actions'

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
      if (formData.get('mode') === 'new-password') {
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
