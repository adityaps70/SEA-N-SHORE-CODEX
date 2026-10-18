import type { SessionGuard } from './session-guard'
import type { SessionRepository } from './session-repository'
import type { SessionRevokeReason } from './types'

/**
 * Round H (H3): signing devices out. A revoked row is refused by the session check on that device's next request
 * (at once on this server, within 30 seconds on the others), its auth cookies are cleared and it is sent to sign-in.
 *
 * Cognito's refresh tokens of OTHER devices are not revoked: RevokeToken needs the refresh token itself, and the app
 * deliberately does not keep members' refresh tokens on the server (a database leak would then hand out 30-day
 * sign-ins). The session check refuses those tokens instead, and access tokens expire after 60 minutes. The device
 * signing itself out revokes its own refresh token (it has it), and a refused device's token is revoked when it is
 * sent to sign-in. GlobalSignOut is never used for these, because it ends every device.
 */
export function createSessionControls(input: {
  repository: Pick<SessionRepository, 'revoke' | 'revokeOthers'>
  guard: Pick<SessionGuard, 'markRevoked'>
}) {
  return {
    async signOutSession(profileId: string, sessionId: string, reason: SessionRevokeReason = 'signed_out_remotely') {
      const revoked = await input.repository.revoke(profileId, sessionId, reason)
      if (revoked) input.guard.markRevoked([sessionId])
      return revoked
    },

    /** Every session but `keepSessionId`; null (an untracked current session) signs out all tracked ones. */
    async signOutOtherSessions(profileId: string, keepSessionId: string | null, reason: SessionRevokeReason) {
      const ids = await input.repository.revokeOthers(profileId, keepSessionId, reason)
      input.guard.markRevoked(ids)
      return ids.length
    },
  }
}

export type SessionControls = ReturnType<typeof createSessionControls>
