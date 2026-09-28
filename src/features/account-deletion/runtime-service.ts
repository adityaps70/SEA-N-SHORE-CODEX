import { createCognitoApi } from '@/lib/auth/cognito-api'
import { query } from '@/lib/db/client'
import { getCognitoEnvironment } from '@/lib/env'
import { createPhoneAuthAdmin } from '@/features/auth/phone-auth-admin'
import { stopAutoRenewForClosingAccount } from '@/features/billing/account-closure'
import { eventPaymentService } from '@/features/payments/event-payment-runtime'
import { accountDeletionRepository } from './repository'
import { createAccountDeletionService, type AccountDeletionEffects } from './service'

/** Billing, refunds, attendee notices and sign-in cleanup, shared by member and admin deletion. */
export function runtimeAccountDeletionEffects(): AccountDeletionEffects {
  const environment = getCognitoEnvironment()
  return {
    stopAutoRenew: async (profileId) => { await stopAutoRenewForClosingAccount(profileId) },
    refundTicket: async (orderId) => {
      await eventPaymentService.refundOrder({ orderId, actor: { type: 'system' }, reason: 'event_cancelled' })
    },
    notifyEventCancelled: async (attendee) => {
      await query(
        `insert into public.notifications (recipient_id, actor_id, notification_type)
         values ($1, null, 'event_cancelled')`,
        [attendee.profileId],
      )
    },
    deleteOtherSignIn: async (username) => {
      await createPhoneAuthAdmin({
        userPoolId: environment.AWS_COGNITO_USER_POOL_ID,
        region: environment.AWS_COGNITO_REGION,
      }).deleteUser(username)
    },
  }
}

/** The account deletion service wired to Cognito, the database, Cashfree and S3. Server only. */
export function createRuntimeAccountDeletionService() {
  const environment = getCognitoEnvironment()
  const api = createCognitoApi({
    region: environment.AWS_COGNITO_REGION,
    clientId: environment.AWS_COGNITO_CLIENT_ID,
  })
  return createAccountDeletionService({ api, effects: runtimeAccountDeletionEffects() })
}

export const runtimeAccountDeletionService = {
  async deleteAccount(input: {
    profileId: string
    email: string | null
    password: string
    cognitoSub?: string | null
  }) {
    return createRuntimeAccountDeletionService().deleteAccount(input)
  },

  /** Deletion after a passwordless check (mobile code or recent Google sign-in). */
  async deleteVerifiedAccount(input: {
    profileId: string
    cognitoSub?: string | null
    deleteIdentity: () => Promise<void>
  }) {
    return createRuntimeAccountDeletionService().deleteVerifiedAccount(input)
  },

  /** What deleting this member's account would do, for the delete-account screen. */
  getDeletionPlan(profileId: string) {
    return accountDeletionRepository.getDeletionPlan(profileId)
  },
}
