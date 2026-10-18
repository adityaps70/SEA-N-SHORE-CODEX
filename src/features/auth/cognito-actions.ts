import { z } from 'zod'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import {
  COGNITO_COOKIE_NAMES,
  createCognitoCookieManager,
} from '@/lib/auth/cognito-cookies'
import { isDisposableEmail } from '@/lib/auth/disposable-email'
import { AUTH_EMAIL_RATE_LIMITED_MESSAGE, DISPOSABLE_EMAIL_MESSAGE } from '@/lib/errors/user-messages'
import type { AuthEmailAction, AuthEmailLimiter } from './email-limits'
import { resetPasswordSchema, signInSchema, signUpSchema } from './schemas'
import { cognitoPasswordRule, failedPasswordRules, PASSWORD_MAX_LENGTH, passwordRulesMessage } from './password-rules'
import { plainIssueMessage } from '@/lib/validation/plain-messages'

export type CognitoAuthActionState = {
  error?: string
  message?: string
  next?: 'new-password' | 'confirm-sign-up' | 'confirm-reset' | 'mfa'
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
  | { kind: 'software-token-mfa'; session: string; username: string }

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
  resendConfirmationCode(username: string): Promise<void>
  confirmSignUp(input: { username: string; code: string }): Promise<void>
  forgotPassword(username: string): Promise<void>
  confirmForgotPassword(input: {
    username: string
    code: string
    newPassword: string
  }): Promise<void>
  /** Round H (H3): per-device sign-out (Cognito RevokeToken). Other devices stay signed in. */
  revokeToken(refreshToken: string): Promise<void>
}

const emailSchema = z.string().trim().toLowerCase().email().max(254)
const codeSchema = z.string().trim().min(1)
const passwordSchema = z.string().min(12).max(72)

const newPasswordSchema = z.object({
  password: passwordSchema,
  passwordConfirmation: z.string(),
})

const confirmationSchema = z.object({
  email: emailSchema,
  code: codeSchema,
})

const confirmResetSchema = z.object({
  email: emailSchema,
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
  onCognitoIssue?: (context: { operation: string; reason: string }) => void
  /** Round 14 (2.6): per-email and per-IP limits for sign-up, code resend and password reset. */
  emailLimiter?: AuthEmailLimiter
  /** The trusted client IP of this request (see trustedClientIp), used only for the limiter. */
  clientIp?: string | null
  /** Round H (H3): signs the MFA challenge to its user, so a backup code is only checked for that member. */
  signMfaChallenge?: (challenge: { session: string; username: string }) => string | null
}) {
  const cookies = createCognitoCookieManager(input.cookieStore, input.siteUrl, {
    allowInsecureHttp: input.allowInsecureHttpCookies === true,
  })

  /**
   * Null when the attempt may go on to Cognito, else the error to show: the generic rate-limit
   * message (which says nothing about whether an account exists), or the flow's own retry message
   * when the limiter itself failed closed.
   */
  async function emailLimitError(action: AuthEmailAction, email: string, unavailableMessage: string) {
    if (!input.emailLimiter) return null
    const decision = await input.emailLimiter.consume({ action, email, ip: input.clientIp ?? null })
    if (decision.allowed) return null
    return decision.reason === 'rate_limited' ? AUTH_EMAIL_RATE_LIMITED_MESSAGE : unavailableMessage
  }

  function reportCognitoIssue(operation: string, error: CognitoApiError) {
    const context = {
      operation,
      reason: error.code.replace(/Exception$/, ''),
    }
    if (input.onCognitoIssue) {
      input.onCognitoIssue(context)
      return
    }
    console.warn('[cognito_issue]', context)
  }

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

        // Round 14 (2.11): the password was right; the authenticator code comes next. The Cognito
        // session stays in an HTTP-only cookie, never in the URL or the page.
        if (result.kind === 'software-token-mfa') {
          cookies.setMfaChallenge({
            session: result.session,
            username: result.username,
            binding: input.signMfaChallenge?.({ session: result.session, username: result.username }) ?? null,
          })
          return { next: 'mfa' }
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
        const issue = parsed.error.issues[0]
        if (issue?.path[0] === 'password') {
          const password = String(formData.get('password') ?? '')
          if (password.length > PASSWORD_MAX_LENGTH) return { error: `Use ${PASSWORD_MAX_LENGTH} characters or fewer for your password.` }
          return { error: passwordRulesMessage(failedPasswordRules(password)) }
        }
        return { error: issue ? plainIssueMessage(issue, { fullName: 'Full name', email: 'Email address' }) : 'Check your details.' }
      }
      // The pool's password policy, checked here first so the message names the exact rule (and a
      // typo does not count against the sign-up email limit).
      const failedRules = failedPasswordRules(parsed.data.password)
      if (failedRules.length > 0) return { error: passwordRulesMessage(failedRules) }
      if (isDisposableEmail(parsed.data.email)) return { error: DISPOSABLE_EMAIL_MESSAGE }
      const limited = await emailLimitError('sign_up', parsed.data.email, 'We could not create your account. Please try again.')
      if (limited) return { error: limited }

      try {
        await input.api.signUp({
          username: parsed.data.email,
          password: parsed.data.password,
          fullName: parsed.data.fullName,
        })
        return { message: 'Check your email to continue.' }
      } catch (error) {
        if (isCognitoError(error) && nonEnumeratingSignupErrorCodes.has(error.code)) {
          try {
            await input.api.resendConfirmationCode(parsed.data.email)
          } catch {
            // Preserve non-enumerating signup behavior for confirmed or throttled identities.
          }
          return { message: 'Check your email to continue.' }
        }
        if (isCognitoError(error)) {
          reportCognitoIssue('signUp', error)
          if (error.code === 'TooManyRequestsException') {
            return { error: 'Too many sign-up requests. Please wait a moment and try again.' }
          }
          if (error.code === 'LimitExceededException') {
            return { error: 'Email confirmation is temporarily unavailable. Please try again in a little while, or continue with Google if it is offered.' }
          }
          if (error.code === 'InvalidPasswordException') {
            const rule = cognitoPasswordRule(error.reason)
            return { error: passwordRulesMessage(rule ? [rule] : failedPasswordRules(parsed.data.password)) }
          }
        }
        return { error: 'We could not create your account. Please try again.' }
      }
    },

    async resendConfirmationCode(
      _state: CognitoAuthActionState,
      formData: FormData,
    ): Promise<CognitoAuthActionState> {
      const parsed = emailSchema.safeParse(formData.get('email'))
      if (!parsed.success) return { error: 'Enter a valid email address.' }
      const limited = await emailLimitError(
        'resend_code',
        parsed.data,
        'We could not resend the confirmation code. Please check the email address or try again.',
      )
      if (limited) return { error: limited }

      try {
        await input.api.resendConfirmationCode(parsed.data)
        return { message: 'Confirmation code sent.' }
      } catch (error) {
        if (isCognitoError(error) && (error.code === 'LimitExceededException' || error.code === 'TooManyRequestsException')) {
          return { error: 'Too many confirmation requests. Please try again later.' }
        }
        return { error: 'We could not resend the confirmation code. Please check the email address or try again.' }
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
      const limited = await emailLimitError('password_reset', parsed.data.email, 'We could not request a reset code. Please try again.')
      if (limited) return { error: limited }

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
      // Round H (H3): sign-out is per device. Revoking this device's refresh token also ends every access token
      // issued from it; GlobalSignOut would have signed out the member's other devices too.
      const refreshToken = input.cookieStore.get(COGNITO_COOKIE_NAMES.refresh)?.value
      try {
        if (refreshToken) await input.api.revokeToken(refreshToken)
      } catch {
        // Local sign-out must complete even when Cognito has already invalidated the token.
      } finally {
        cookies.clearCognitoCookies()
      }
    },
  }
}
