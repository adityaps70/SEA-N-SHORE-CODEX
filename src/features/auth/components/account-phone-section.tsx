import { getAccountPhoneSummary } from '@/features/auth/phone-link-runtime'
import { AccountPhonePanel } from './account-phone-panel'

/** Server wrapper: loads the member's mobile numbers for Settings. */
export async function AccountPhoneSection() {
  const summary = await getAccountPhoneSummary()
  return <AccountPhonePanel summary={summary} />
}
