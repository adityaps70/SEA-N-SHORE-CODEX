import type { PhoneAuthActionState, createPhoneAuthActions } from './phone-auth-actions'

type PhoneActions = ReturnType<typeof createPhoneAuthActions>
type Redirect = (path: string) => void

const POST_SIGN_IN_PATH = '/auth/post-sign-in'

export function createPhoneAuthActionHandlers(input: {
  getActions: () => Promise<PhoneActions>
  redirect: Redirect
}) {
  return {
    async requestOtp(
      state: PhoneAuthActionState,
      formData: FormData,
    ): Promise<PhoneAuthActionState> {
      const actions = await input.getActions()
      const result = await actions.requestOtp(state, formData)
      if (result.next === 'confirm-phone') {
        const intent = formData.get('intent') === 'sign-up' ? 'sign-up' : 'sign-in'
        input.redirect(`/auth/phone?intent=${intent}&step=confirm`)
      }
      return result
    },

    async confirmOtp(
      state: PhoneAuthActionState,
      formData: FormData,
    ): Promise<PhoneAuthActionState> {
      const actions = await input.getActions()
      const result = await actions.confirmOtp(state, formData)
      if (result.message === 'Signed in.') input.redirect(POST_SIGN_IN_PATH)
      return result
    },
  }
}
