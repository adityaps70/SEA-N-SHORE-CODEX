import { z } from 'zod'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import {
  COGNITO_COOKIE_NAMES,
  createCognitoCookieManager,
} from '@/lib/auth/cognito-cookies'
import { resetPasswordSchema, signInSchema, signUpSchema } from './schemas'

export type CognitoAuthActionState = {
  error?: string
  message?: string
  next?: 'new-password' | 'confirm-sign-up' | 'confirm-reset'
}

type CookieStore = {
  get(name: string): { name: string; value: string } | undefined
  set(name: string, value: string, options?: Record<string, unknown>): void
  delete(name: string): void
}

type AuthenticationResult = {
  accessToken: string
  idToken?: string
  refreshToken?: string
  expiresIn: number
}

type SignInResult =
  | { kind: 'authenticated'; authentication: AuthenticationResult }
  | { kind: 'new-password-required'; session: string; username: string }

type CognitoActionsApi = {
  signIn(input: { username: string; password: string }): Promise<SignInResult>
  respondToNewPassword(input: {
    username: string
    newPassword: string
    session: string
  }): Promise<AuthenticationResult>
  signUp(input: {
    username: string
    password: string
    fullName: string
  }): Promise<{ userSub: string; userConfirmed: boolean }>
  confirmSignUp(input: { username: string; code: string }): Promise<void>
  forgotPassword(username: string): Promise<void>
  confirmForgotPassword(input: {
    username: string
    code: string
    newPassword: string
  }): Promise<void>
  globalSignOut(accessToken: string): Promise<void>
}

const codeSchema = z.string().trim().min(1)
const passwordSchema = z.string().min(12).max(72)

const newPasswordSchema = z.object({
  password: passwordSchema,
  passwordConfirmation: z.string(),
})

const confirmationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  code: codeSchema,
})

const confirmResetSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  code: codeSchema,
  password: passwordSchema,
  passwordConfirmation: z.string(),
})

const genericSignInErrorCodes = new Set([
  'NotAuthorizedException',
  'UserNotFoundException',
])

const nonEnumeratingSignupErrorCodes = new Set([
  'UsernameExistsException',
])

const nonEnumeratingResetErrorCodes = new Set([
  'UserNotFoundException',
  'NotAuthorizedException',
])

const resetCodeErrorCodes = new Set([
  'CodeMismatchException',
  'ExpiredCodeException',
])

function isCognitoError(error: unknown): error is CognitoApiError {
  return error instanceof CognitoApiError
}

export function createCognitoAuthActions(input: {
  api: CognitoActionsApi
  cookieStore: CookieStore
  siteUrl: string
  allowInsecureHttpCookies?: boolean
}) {
  const cookies = createCognitoCookieManager(input.cookieStore, input.siteUrl, {
    allowInsecureHttp: input.allowInsecureHttpCookies === true,
  })

  return {
    async signIn(
      _state: CognitoAuthActionState,
      formData: FormData,
    ): Promise<CognitoAuthActionState> {
      const parsed = signInSchema.safeParse(Object.fromEntries(formData))
      if (!parsed.success) return { error: 'Enter a valid email and password.' }

      try {
        const result = await input.api.signIn({
          username: parsed.data.email,
          password: parsed.data.password,
        })

        if (result.kind === 'new-password-required') {
          cookies.setChallenge({
            session: result.session,
            username: result.username,
          })
          return { next: 'new-password' }
        }

        cookies.setAuthentication(result.authentication)
        return { message: 'Signed in.' }
      } catch (error) {
        if (isCognitoError(error) && genericSignInErrorCodes.has(error.code)) {
          return { error: 'Email or password is incorrect.' }
        }
        return { error: 'We could not finish signing you in. Please try again.' }
      }
    },

    async completeNewPassword(
      _state: CognitoAuthActionState,
      formData: FormData,
    ): Promise<CognitoAuthActionState> {
      const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData))
      if (!parsed.success) return { error: 'Use at least 12 characters.' }
      if (parsed.data.password !== parsed.data.passwordConfirmation) {
        return { error: 'Passwords do not match.' }
      }

      const session = input.cookieStore.get(COGNITO_COOKIE_NAMES.challenge)?.value
      const username = input.cookieStore.get(COGNITO_COOKIE_NAMES.challengeUser)?.value
      if (!session || !username) {
        return { error: 'Your sign-in challenge expired. Please sign in again.' }
      }

      try {
        const authentication = await input.api.respondToNewPassword({
          username,
          newPassword: parsed.data.password,
          session,
        })

        cookies.clearCognitoCookies()
        cookies.setAuthentication(authentication)
        return { message: 'Password updated.' }
      } catch (error) {
        if (isCognitoError(error) && resetCodeErrorCodes.has(error.code)) {
          return { error: 'Your sign-in challenge expired. Please sign in again.' }
        }
        return { error: 'The password could not be updated. Please sign in again.' }
      }
    },

    async signUp(
      _state: CognitoAuthActionState,
      formData: FormData,
    ): Promise<CognitoAuthActionState> {
      const parsed = signUpSchema.safeParse(Object.fromEntries(formData))
      if (!parsed.success) {
        return { error: parsed.error.issues[0]?.message ?? 'Check your details.' }
      }

      try {
        await input.api.signUp({
          username: parsed.data.email,
          password: parsed.data.password,
          fullName: parsed.data.fullName,
        })
        return { message: 'Check your email to continue.' }
      } catch (error) {
        if (isCognitoError(error) && nonEnumeratingSignupErrorCodes.has(error.code)) {
          return { message: 'Check your email to continue.' }
        }
        return { error: 'We could not create your account. Please try again.' }
      }
    },

    async confirmSignUp(
      _state: CognitoAuthActionState,
      formData: FormData,
    ): Promise<CognitoAuthActionState> {
      const parsed = confirmationSchema.safeParse(Object.fromEntries(formData))
      if (!parsed.success) return { error: 'Enter a valid confirmation code.' }

      try {
        await input.api.confirmSignUp({
          username: parsed.data.email,
          code: parsed.data.code,
        })
        return { message: 'Email confirmed.' }
      } catch (error) {
        if (isCognitoError(error) && resetCodeErrorCodes.has(error.code)) {
          return { error: 'The confirmation code is invalid or expired. Try again.' }
        }
        return { error: 'We could not confirm your account. Please try again.' }
      }
    },

    async requestPasswordReset(
      _state: CognitoAuthActionState,
      formData: FormData,
    ): Promise<CognitoAuthActionState> {
      const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData))
      if (!parsed.success) return { error: 'Enter a valid email address.' }

      try {
        await input.api.forgotPassword(parsed.data.email)
      } catch (error) {
        if (!(isCognitoError(error) && nonEnumeratingResetErrorCodes.has(error.code))) {
          return { error: 'We could not request a reset code. Please try again.' }
        }
      }

      return {
        message: 'If the account exists, a reset code is on its way.',
        next: 'confirm-reset',
      }
    },

    async confirmPasswordReset(
      _state: CognitoAuthActionState,
      formData: FormData,
    ): Promise<CognitoAuthActionState> {
      const parsed = confirmResetSchema.safeParse(Object.fromEntries(formData))
      if (!parsed.success) return { error: 'Check the reset details and try again.' }
      if (parsed.data.password !== parsed.data.passwordConfirmation) {
        return { error: 'Passwords do not match.' }
      }

      try {
        await input.api.confirmForgotPassword({
          username: parsed.data.email,
          code: parsed.data.code,
          newPassword: parsed.data.password,
        })
        return { message: 'Password updated. You can sign in now.' }
      } catch (error) {
        if (isCognitoError(error) && resetCodeErrorCodes.has(error.code)) {
          return { error: 'The reset code is invalid or expired. Try again.' }
        }
        return { error: 'The password could not be updated. Request a new reset code.' }
      }
    },

    async signOut(): Promise<void> {
      const accessToken = input.cookieStore.get(COGNITO_COOKIE_NAMES.access)?.value
      try {
        if (accessToken) await input.api.globalSignOut(accessToken)
      } catch {
        // Local sign-out must complete even when Cognito has already invalidated the token.
      } finally {
        cookies.clearCognitoCookies()
      }
    },
  }
}
