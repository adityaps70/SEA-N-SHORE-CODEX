import { createBackupCodeRepository } from './backup-codes'
import { accountQuery } from './runtime'
import type { AccountQuery } from './types'

/**
 * Admin two-step (owner, 21 Nov): admins and country admins without unused backup codes are reminded to make some,
 * so a lost phone doesn't lock them out (and a super-admin reset is rarely needed). True only when the count was
 * read and is zero; a failed read shows no reminder.
 */
export function createBackupCodeReminder(query: AccountQuery = accountQuery) {
  return async function needsBackupCodes(profileId: string): Promise<boolean> {
    try {
      return (await createBackupCodeRepository({ query }).status(profileId)).remaining === 0
    } catch {
      return false
    }
  }
}

export const needsBackupCodes = createBackupCodeReminder()

export const BACKUP_CODES_REMINDER = 'Create backup codes so a lost phone doesn’t lock you out of admin pages.'
export const BACKUP_CODES_HREF = '/settings/account#backup-codes-heading'
