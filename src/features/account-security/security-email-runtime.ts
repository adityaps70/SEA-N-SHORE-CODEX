import { accountQuery, accountTransaction } from './runtime'
import { createAccountSecurityEmailRepository, createAccountSecurityEmailWorker } from './security-emails'

/** Round H (H3): the account security notice sender the outbox worker runs every minute. */
export function createProductionAccountSecurityEmailWorker() {
  return createAccountSecurityEmailWorker({
    repository: createAccountSecurityEmailRepository({ query: accountQuery, transaction: accountTransaction }),
  })
}
