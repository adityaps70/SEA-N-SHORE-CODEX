import type { AccountQuery } from './types'

/**
 * Round H (H3): per-member limits for account security actions, counted in public.account_security_attempts.
 * Every attempt that passes the check is recorded (even if Cognito then refuses it), so repeated failures count.
 * Attempts for one member and action are serialized with a transaction-scoped advisory lock, so the caller runs
 * `consume` inside a transaction.
 */
export type AccountSecurityAction =
  | 'password_change'
  | 'email_change_code'
  | 'email_change_verify'
  | 'backup_codes_generate'
  | 'backup_code_sign_in'

export const ACCOUNT_SECURITY_LIMITS: Readonly<Record<AccountSecurityAction, { max: number; window: string }>> = {
  password_change: { max: 5, window: '15 minutes' },
  email_change_code: { max: 3, window: '1 hour' },
  email_change_verify: { max: 10, window: '1 hour' },
  backup_codes_generate: { max: 5, window: '15 minutes' },
  backup_code_sign_in: { max: 5, window: '15 minutes' },
}

const RETENTION = '2 days'

export async function consumeAccountSecurityAttempt(query: AccountQuery, profileId: string, action: AccountSecurityAction): Promise<boolean> {
  const limit = ACCOUNT_SECURITY_LIMITS[action]
  await query(`select pg_advisory_xact_lock(hashtext('account_security:' || $1::text || ':' || $2::text)) as locked`, [action, profileId])
  const [usage] = await query(
    `select count(*)::int as total
     from (
       select 1 from public.account_security_attempts
       where profile_id = $1 and action = $2 and created_at > now() - $3::interval
       limit $4
     ) recent`,
    [profileId, action, limit.window, limit.max],
  )
  if (Number(usage?.total ?? 0) >= limit.max) return false
  await query(
    `with pruned as (
       delete from public.account_security_attempts
       where id in (
         select id from public.account_security_attempts
         where profile_id = $1 and created_at < now() - $3::interval
         order by created_at
         limit 50
       )
     )
     insert into public.account_security_attempts (profile_id, action) values ($1, $2)`,
    [profileId, action, RETENTION],
  )
  return true
}
