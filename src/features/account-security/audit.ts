import type { AccountQuery } from './types'

/** Round H (H3): audit rows for account security events. Metadata never holds a code, password, token or email. */
export type AccountSecurityAuditAction =
  | 'account.password_changed'
  | 'account.email_changed'
  | 'account.sessions_signed_out'
  | 'account.mfa_backup_codes_generated'
  | 'account.mfa_backup_codes_regenerated'
  | 'account.mfa_backup_code_used'
  | 'account.mfa_reset'
  /** Hotfix P1: a platform administrator signed in with Google confirmed it is them to open admin pages. */
  | 'account.admin_step_up'
  /** Admin two-step (owner, 21 Nov): the member replaced their authenticator app after confirming it was them. */
  | 'account.mfa_replaced'

export async function recordAccountSecurityAudit(
  query: AccountQuery,
  profileId: string,
  action: AccountSecurityAuditAction,
  metadata: Record<string, string | number | boolean> = {},
) {
  await query(
    `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
     values ($1::uuid, $2, 'profile', $1::text, $3::jsonb)`,
    [profileId, action, JSON.stringify(metadata)],
  )
}
