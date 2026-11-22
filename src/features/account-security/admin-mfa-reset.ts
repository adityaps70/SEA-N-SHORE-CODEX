import type { AccountQuery, AccountTransaction } from './types'

/**
 * Admin two-step (owner, 21 Nov): a platform administrator resets the two-step verification of a member who lost
 * their phone and has no backup codes (an admin or country admin most often). In one transaction:
 * - the authenticator app is turned off in Cognito (every Cognito sign-in of the member);
 * - the member's unused backup codes are deleted;
 * - every session of the member is signed out;
 * - the audit log records who reset whom and why (account.mfa_reset_by_admin), and the member's own security event.
 * A Cognito refusal rolls everything back. The member then signs in with their password; an admin or country admin
 * is sent to set up a new app before any admin page opens (the existing admin MFA gate).
 *
 * Guards: platform administrators only (checked in SQL, locked), never yourself, a reason of at least 10 characters,
 * and the member's @username typed to confirm. Country admins can never use it.
 */
export const MFA_RESET_REASON_MIN = 10

export type AdminMfaResetResult =
  | { status: 'reset'; sessionsSignedOut: number; emailed: boolean }
  | { status: 'error'; code: 'admin_forbidden' | 'own_account' | 'reason_required' | 'confirmation_mismatch' | 'member_not_found' | 'no_cognito_sign_in' }

export type AdminMfaResetDeps = {
  transaction: AccountTransaction
  /** Turns the authenticator app off for one Cognito user (AdminSetUserMFAPreference; the sub is accepted). */
  disableSoftwareTokenMfa: (cognitoUsername: string) => Promise<void>
  /** Signs out every session of the member; returns the session ids (so the session guard can drop them at once). */
  revokeAllSessions: (query: AccountQuery, profileId: string) => Promise<string[]>
  markRevoked?: (sessionIds: string[]) => void
  sendNotice: (input: { to: string | null; idempotencyKey: string }) => Promise<boolean>
}

export function createAdminMfaReset(deps: AdminMfaResetDeps) {
  return async function resetMemberTwoStep(input: { adminId: string; profileId: string; reason: string; confirmUsername: string }): Promise<AdminMfaResetResult> {
    const reason = input.reason.trim()
    if (input.adminId === input.profileId) return { status: 'error', code: 'own_account' }
    if (reason.length < MFA_RESET_REASON_MIN) return { status: 'error', code: 'reason_required' }

    const outcome = await deps.transaction(async (query) => {
      const admin = await query(
        `select 1 as allowed from public.user_roles where user_id = $1 and role::text = 'administrator' limit 1 for update`,
        [input.adminId],
      )
      if (!admin[0]) return { error: 'admin_forbidden' as const }
      const members = await query(`select id, slug from public.profiles where id = $1 for update`, [input.profileId])
      const member = members[0]
      if (!member) return { error: 'member_not_found' as const }
      const typed = input.confirmUsername.trim().replace(/^@/, '').toLowerCase()
      if (!member.slug || typed !== String(member.slug).toLowerCase()) return { error: 'confirmation_mismatch' as const }

      const identities = await query(
        `select provider_subject, email, email_verified from public.identity_accounts where profile_id = $1 and provider = 'cognito' order by id`,
        [input.profileId],
      )
      if (!identities.length) return { error: 'no_cognito_sign_in' as const }
      // Inside the transaction: if Cognito refuses, nothing below is kept.
      for (const identity of identities) await deps.disableSoftwareTokenMfa(String(identity.provider_subject))
      await query(`delete from public.mfa_backup_codes where profile_id = $1 and used_at is null`, [input.profileId])
      const revoked = await deps.revokeAllSessions(query, input.profileId)

      const audit = await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'account.mfa_reset_by_admin', 'profile', $2, $3::jsonb) returning id`,
        [input.adminId, input.profileId, JSON.stringify({ reason, sessionsSignedOut: revoked.length, actorRole: 'platform_admin', section: 'users' })],
      )
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1::uuid, 'account.mfa_reset', 'profile', $1::text, $2::jsonb)`,
        [input.profileId, JSON.stringify({ byAdministrator: true, sessionsSignedOut: revoked.length })],
      )
      const verified = identities.find((identity) => identity.email_verified === true && typeof identity.email === 'string')
      return { revoked, auditId: String(audit[0]!.id), email: verified ? String(verified.email) : null }
    })
    if ('error' in outcome) return { status: 'error', code: outcome.error! }

    deps.markRevoked?.(outcome.revoked)
    const emailed = await deps.sendNotice({ to: outcome.email, idempotencyKey: `mfa-reset-by-admin/${outcome.auditId}` })
    return { status: 'reset', sessionsSignedOut: outcome.revoked.length, emailed }
  }
}
