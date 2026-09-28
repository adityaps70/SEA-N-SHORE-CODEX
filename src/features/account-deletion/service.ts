import { CognitoApiError, type CognitoSignInResult } from '@/lib/auth/cognito-api'
import { deleteMediaObject as runtimeDeleteMediaObject } from '@/lib/aws/storage'
import { accountDeletionRepository, type AccountDeletionResult } from './repository'

export type CognitoDeletionApi = {
  signIn(input: { username: string; password: string }): Promise<CognitoSignInResult>
  deleteUser(accessToken: string): Promise<void>
}

export type AccountDeletionRepository = {
  deleteAccountWithIdentity(
    profileId: string,
    deleteIdentity: () => Promise<void>,
    options?: { currentSub?: string | null },
  ): Promise<AccountDeletionResult>
  finalizeAccountDeletion(
    profileId: string,
    options?: { currentSub?: string | null },
  ): Promise<AccountDeletionResult>
}

type DeleteMediaObject = (key: string) => Promise<void>

/** Side effects outside the database, all optional so tests and older callers keep working. */
export type AccountDeletionEffects = {
  /** Turns off auto-renew on plans paid with this member's mandate. Throws when it cannot. */
  stopAutoRenew?: (profileId: string) => Promise<void>
  /** Refunds one paid ticket of an event the deletion cancelled. */
  refundTicket?: (orderId: string) => Promise<void>
  /** Tells an attendee their event was cancelled. */
  notifyEventCancelled?: (input: { profileId: string; eventId: string; eventTitle: string }) => Promise<void>
  /** Removes another Cognito user that signed in to this profile (e.g. a mobile sign-in). */
  deleteOtherSignIn?: (username: string) => Promise<void>
  log?: (message: string, details?: Record<string, unknown>) => void
}

export class AccountDeletionError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'AccountDeletionError'
    this.code = code
  }
}

function isFirstPartyStoragePath(value: string) {
  if (!value.trim()) return false
  try {
    const url = new URL(value)
    return url.protocol !== 'http:' && url.protocol !== 'https:'
  } catch {
    return !value.startsWith('/')
  }
}

export function createAccountDeletionService(input: {
  api: CognitoDeletionApi
  repository?: AccountDeletionRepository
  deleteMediaObject?: DeleteMediaObject
  effects?: AccountDeletionEffects
}) {
  const repository = input.repository ?? accountDeletionRepository
  const deleteMedia = input.deleteMediaObject ?? runtimeDeleteMediaObject
  const effects = input.effects ?? {}
  const log = effects.log ?? ((message, details) => console.error(message, details ?? {}))

  async function deleteCollectedMedia(paths: string[]) {
    const unique = [...new Set(paths.filter(isFirstPartyStoragePath))]
    if (!unique.length) return

    const results = await Promise.allSettled(unique.map((path) => deleteMedia(path)))
    const failures = results.filter((result) => result.status === 'rejected').length
    if (failures > 0) {
      console.error('[account_deletion_media_cleanup_incomplete]', {
        attempted: unique.length,
        failures,
      })
    }
  }

  /** After the commit: refunds, attendee notices and other sign-ins. Failures are logged for the team, never undone. */
  async function afterCommit(result: AccountDeletionResult) {
    let refundFailures = 0
    for (const orderId of result.refundOrderIds ?? []) {
      if (!effects.refundTicket) break
      try {
        await effects.refundTicket(orderId)
      } catch {
        refundFailures += 1
      }
    }
    if (refundFailures) log('account_deletion_refunds_incomplete', { attempted: result.refundOrderIds?.length ?? 0, failures: refundFailures })

    let noticeFailures = 0
    for (const attendee of result.cancelledEventAttendees ?? []) {
      if (!effects.notifyEventCancelled) break
      try {
        await effects.notifyEventCancelled(attendee)
      } catch {
        noticeFailures += 1
      }
    }
    if (noticeFailures) log('account_deletion_event_notices_incomplete', { failures: noticeFailures })

    let signInFailures = 0
    for (const username of result.otherSignInUsernames ?? []) {
      if (!effects.deleteOtherSignIn) break
      try {
        await effects.deleteOtherSignIn(username)
      } catch {
        signInFailures += 1
      }
    }
    if (signInFailures) log('account_deletion_sign_in_cleanup_incomplete', { failures: signInFailures })
  }

  /**
   * The deletion itself, once the person asking has been verified (member password, a
   * fresh mobile code, a recent Google sign-in, or a platform administrator). Turns off
   * auto-renew first, deletes in one transaction (removing the Cognito user inside it),
   * then refunds, notifies and cleans up.
   */
  async function deleteVerifiedAccount(inputValue: {
    profileId: string
    cognitoSub?: string | null
    deleteIdentity: () => Promise<void>
  }) {
    // Nothing is deleted while a plan could still charge the member's mandate.
    if (effects.stopAutoRenew) {
      try {
        await effects.stopAutoRenew(inputValue.profileId)
      } catch (error) {
        log('account_deletion_auto_renew_stop_failed', { message: error instanceof Error ? error.message : null })
        throw new AccountDeletionError('account_deletion_billing_cancel_failed')
      }
    }

    const options = { currentSub: inputValue.cognitoSub ?? null }
    let identityDeleted = false
    let result: AccountDeletionResult
    try {
      result = await repository.deleteAccountWithIdentity(
        inputValue.profileId,
        async () => {
          await inputValue.deleteIdentity()
          identityDeleted = true
        },
        options,
      )
    } catch (error) {
      if (!identityDeleted) throw error

      try {
        result = await repository.finalizeAccountDeletion(inputValue.profileId, options)
      } catch {
        throw new AccountDeletionError('account_deletion_cleanup_failed')
      }
    }

    await afterCommit(result)
    await deleteCollectedMedia(result.mediaPaths)
    return { ok: true as const }
  }

  return {
    deleteVerifiedAccount,

    /** Member deletion with a password (email sign-in). */
    async deleteAccount(inputValue: {
      profileId: string
      email: string | null
      password: string
      cognitoSub?: string | null
    }) {
      const email = inputValue.email?.trim().toLowerCase()
      if (!email) {
        throw new AccountDeletionError('account_deletion_reauthentication_unavailable')
      }

      let reauthenticated: CognitoSignInResult
      try {
        reauthenticated = await input.api.signIn({
          username: email,
          password: inputValue.password,
        })
      } catch (error) {
        if (error instanceof CognitoApiError && (
          error.code === 'NotAuthorizedException'
          || error.code === 'UserNotFoundException'
        )) {
          throw new AccountDeletionError('account_deletion_reauthentication_failed')
        }
        throw new AccountDeletionError('account_deletion_reauthentication_unavailable')
      }

      if (reauthenticated.kind !== 'authenticated') {
        throw new AccountDeletionError('account_deletion_reauthentication_unavailable')
      }

      const accessToken = reauthenticated.authentication.accessToken
      return deleteVerifiedAccount({
        profileId: inputValue.profileId,
        cognitoSub: inputValue.cognitoSub,
        deleteIdentity: () => input.api.deleteUser(accessToken),
      })
    },
  }
}
