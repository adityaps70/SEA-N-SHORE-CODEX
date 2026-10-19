import type { AccountQuery, SessionRevokeReason } from './types'

/**
 * Round H (H3): public.auth_sessions, one row per signed-in device. Rows are keyed by token_origin_hash (the
 * SHA-256 of the Cognito access token's origin_jti), so the same sign-in always maps to the same row, through
 * every token refresh, and a new sign-in gets a new row.
 */

export type SessionSignInMethod = 'password' | 'google' | 'unknown'

export type NewSessionInput = {
  profileId: string
  originHash: string
  signInMethod: SessionSignInMethod
  userAgentSummary: string | null
  city: string | null
  country: string | null
  ipHash: string | null
}

export type SessionState = {
  id: string
  profileId: string
  revoked: boolean
  /** Round I (I3): a refresh token of this sign-in was used again after it had been exchanged for a newer one. */
  reuseDetected: boolean
  lastSeenAt: Date
}

export type ActiveSession = {
  id: string
  createdAt: string
  lastSeenAt: string
  signInMethod: SessionSignInMethod
  userAgentSummary: string | null
  approxCity: string | null
  approxCountry: string | null
}

/**
 * Sessions not seen for this long are left off the list. Round I (I3): it is also the idle limit, so such a session
 * is refused (the 30-day refresh cookie, renewed on every refresh, has gone from that browser by then too).
 */
export const SESSION_LIST_WINDOW_DAYS = 30
export const SESSION_TOUCH_INTERVAL = '5 minutes'

function toDate(value: unknown) {
  return value instanceof Date ? value : new Date(String(value))
}

function toIso(value: unknown) {
  return toDate(value).toISOString()
}

function stateOf(row: Record<string, unknown>): SessionState {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    revoked: row.revoked_at !== null && row.revoked_at !== undefined,
    reuseDetected: row.reuse_detected_at !== null && row.reuse_detected_at !== undefined,
    lastSeenAt: toDate(row.last_seen_at),
  }
}

export function createSessionRepository(input: { query: AccountQuery }) {
  const { query } = input

  return {
    /** The row for this sign-in, created on first sight (at sign-in, or for a session older than this release). */
    async findOrCreate(session: NewSessionInput): Promise<SessionState> {
      const inserted = await query(
        `insert into public.auth_sessions
           (profile_id, token_origin_hash, sign_in_method, user_agent_summary, approx_city, approx_country, ip_hash)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (token_origin_hash) do nothing
         returning id, profile_id, revoked_at, reuse_detected_at, last_seen_at`,
        [session.profileId, session.originHash, session.signInMethod, session.userAgentSummary, session.city, session.country, session.ipHash],
      )
      if (inserted[0]) return stateOf(inserted[0])
      const existing = await query(
        `select id, profile_id, revoked_at, reuse_detected_at, last_seen_at from public.auth_sessions where token_origin_hash = $1`,
        [session.originHash],
      )
      if (!existing[0]) throw new Error('auth_session_unavailable')
      return stateOf(existing[0])
    },

    async findByOrigin(originHash: string): Promise<SessionState | null> {
      const rows = await query(
        `select id, profile_id, revoked_at, reuse_detected_at, last_seen_at from public.auth_sessions where token_origin_hash = $1`,
        [originHash],
      )
      return rows[0] ? stateOf(rows[0]) : null
    },

    /** Moves last_seen_at on, at most once every few minutes per session. */
    async touch(sessionId: string) {
      await query(
        `update public.auth_sessions
         set last_seen_at = now()
         where id = $1
           and revoked_at is null
           and last_seen_at < now() - $2::interval`,
        [sessionId, SESSION_TOUCH_INTERVAL],
      )
    },

    async listActive(profileId: string): Promise<ActiveSession[]> {
      const rows = await query(
        `select id, created_at, last_seen_at, sign_in_method, user_agent_summary, approx_city, approx_country
         from public.auth_sessions
         where profile_id = $1
           and revoked_at is null
           and reuse_detected_at is null
           and last_seen_at > now() - make_interval(days => $2::int)
         order by last_seen_at desc, id
         limit 50`,
        [profileId, SESSION_LIST_WINDOW_DAYS],
      )
      return rows.map((row) => ({
        id: String(row.id),
        createdAt: toIso(row.created_at),
        lastSeenAt: toIso(row.last_seen_at),
        signInMethod: (['password', 'google'].includes(String(row.sign_in_method)) ? row.sign_in_method : 'unknown') as SessionSignInMethod,
        userAgentSummary: (row.user_agent_summary as string | null) ?? null,
        approxCity: (row.approx_city as string | null) ?? null,
        approxCountry: (row.approx_country as string | null) ?? null,
      }))
    },

    /** Signs one of the member's own sessions out. False when it is not theirs or already signed out. */
    async revoke(profileId: string, sessionId: string, reason: SessionRevokeReason): Promise<boolean> {
      const rows = await query(
        `update public.auth_sessions
         set revoked_at = now(), revoke_reason = $3
         where id = $1 and profile_id = $2 and revoked_at is null
         returning id`,
        [sessionId, profileId, reason],
      )
      return rows.length > 0
    },

    /** Signs out every session of the member except `keepSessionId` (all of them when it is null). */
    async revokeOthers(profileId: string, keepSessionId: string | null, reason: SessionRevokeReason): Promise<string[]> {
      const rows = await query(
        `update public.auth_sessions
         set revoked_at = now(), revoke_reason = $3
         where profile_id = $1
           and revoked_at is null
           and ($2::uuid is null or id <> $2::uuid)
         returning id`,
        [profileId, keepSessionId, reason],
      )
      return rows.map((row) => String(row.id))
    },
  }
}

export type SessionRepository = ReturnType<typeof createSessionRepository>
