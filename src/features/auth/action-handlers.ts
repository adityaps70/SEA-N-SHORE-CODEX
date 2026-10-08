import { AUTH_EMAIL_RATE_LIMITED_MESSAGE } from '@/lib/errors/user-messages'
import type { CognitoAuthActionState } from './cognito-actions'
import type { createCognitoAuthActions } from './cognito-actions'

export type AuthActionState = CognitoAuthActionState

type CognitoActions = ReturnType<typeof createCognitoAuthActions>
type Redirect = (path: string) => void

const POST_SIGN_IN_PATH = '/auth/post-sign-in'

/**
 * Where the plain "Resend confirmation code" form lands: back on the confirmation step with
 * ?resent=1, ?resendError=limited (too many attempts), or ?resendError=1 (anything else).
 */
export function resendConfirmationRedirectPath(email: string, result: AuthActionState) {
  const params = new URLSearchParams({ confirm: '1', email })
  if (result.message === 'Confirmation code sent.') params.set('resent', '1')
  else if (result.error === AUTH_EMAIL_RATE_LIMITED_MESSAGE) params.set('resendError', 'limited')
  else params.set('resendError', '1')
  return `/auth/sign-up?${params.toString()}`
}

export function createAuthActionHandlers(input: {
  getActions: () => Promise<CognitoActions>
  redirect: Redirect
  getSignOutDestination?: () => string
}) {
  return {
    async signIn(state: AuthActionState, formData: FormData): Promise<AuthActionState> {
      const actions = await input.getActions()
      const result = await actions.signIn(state, formData)
      if (result.next === 'new-password') {
        input.redirect('/auth/update-password?mode=new-password')
        return result
      }
      if (result.next === 'mfa') {
        input.redirect('/auth/mfa')
        return result
      }
      if (result.message === 'Signed in.') input.redirect(POST_SIGN_IN_PATH)
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

    async resendConfirmationCode(formData: FormData): Promise<void> {
      const actions = await input.getActions()
      const email = String(formData.get('email') ?? '').trim().toLowerCase()
      const result = await actions.resendConfirmationCode({}, formData)
      input.redirect(resendConfirmationRedirectPath(email, result))
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
        if (result.message === 'Password updated.') input.redirect(POST_SIGN_IN_PATH)
        return result
      }

      const result = await actions.confirmPasswordReset(state, formData)
      if (result.message === 'Password updated. You can sign in now.') input.redirect('/auth/sign-in')
      return result
    },

    async signOut() {
      const actions = await input.getActions()
      await actions.signOut()
      input.redirect(input.getSignOutDestination?.() ?? '/')
    },
  }
}
