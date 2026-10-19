import { accountSecurityKey } from '@/features/account-security/keys'
import { query } from '@/lib/db/client'
import { createAppHandoffService } from './app-handoff'

/** Round I (I3): the production handoff service. Built per call, so the key is read at request time, not build time. */
export function appHandoffService() {
  return createAppHandoffService({
    query: (text, values) => query(text, values),
    key: accountSecurityKey('app-handoff'),
  })
}
