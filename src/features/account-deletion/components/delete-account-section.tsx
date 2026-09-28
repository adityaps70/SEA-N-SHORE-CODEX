import { getAwsVerifiedUser } from '@/features/auth/aws-queries'
import { accountDeletionRepository } from '@/features/account-deletion/repository'
import type { AccountDeletionPlan } from '@/features/account-deletion/plan'
import { reauthView, type DeletionReauthView } from '@/features/account-deletion/reauth'
import { getDeletionReauth } from '@/features/account-deletion/reauth-runtime'
import { DeleteAccountPanel } from './delete-account-panel'

/**
 * Server wrapper: works out, from the member's real data, what deleting the account
 * would do, and how this session confirms it (password, texted code or recent Google sign-in).
 */
export async function DeleteAccountSection() {
  let plan: AccountDeletionPlan | null = null
  let reauth: DeletionReauthView = { method: 'password' }
  try {
    const user = await getAwsVerifiedUser()
    if (user) {
      const [loadedPlan, loadedReauth] = await Promise.all([
        accountDeletionRepository.getDeletionPlan(user.id),
        getDeletionReauth(user),
      ])
      plan = loadedPlan
      reauth = reauthView(loadedReauth)
    }
  } catch (error) {
    // The panel falls back to the general explanation; deletion itself re-checks everything.
    console.error('account_deletion_plan_failed', { name: error instanceof Error ? error.name : null })
  }
  return <DeleteAccountPanel plan={plan} reauth={reauth} />
}
