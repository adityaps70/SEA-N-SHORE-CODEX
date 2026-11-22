/**
 * Round H (H3): reads claims from a Cognito access token WITHOUT verifying it. Only call this on a token Cognito has
 * just accepted (GetUser answered for it), so the claims are ones Cognito vouched for.
 *
 * `origin_jti` identifies the sign-in the token came from: it stays the same when the token is refreshed, and a new
 * sign-in gets a new one. Sea N Shore keys each signed-in device (public.auth_sessions) on it.
 *
 * `jti` identifies this one access token: every renewal issues a token with a new one (owner, 19 Nov: the session
 * check uses its hash to see that a device received a renewal, see refresh-token-ledger).
 */
export type AccessTokenClaims = {
  originJti: string | null
  jti: string | null
  scopes: string[]
}

const TOKEN_ID = /^[A-Za-z0-9-]{8,128}$/
const NO_CLAIMS: AccessTokenClaims = { originJti: null, jti: null, scopes: [] }

export function decodeAccessTokenClaims(accessToken: string): AccessTokenClaims {
  const payload = accessToken.split('.')[1]
  if (!payload) return { ...NO_CLAIMS, scopes: [] }
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : ''
    const decoded = JSON.parse(atob(normalized + padding)) as { origin_jti?: unknown; jti?: unknown; scope?: unknown }
    const originJti = typeof decoded.origin_jti === 'string' && TOKEN_ID.test(decoded.origin_jti) ? decoded.origin_jti : null
    const jti = typeof decoded.jti === 'string' && TOKEN_ID.test(decoded.jti) ? decoded.jti : null
    const scopes = typeof decoded.scope === 'string' ? decoded.scope.split(/\s+/).filter(Boolean) : []
    return { originJti, jti, scopes }
  } catch {
    return { ...NO_CLAIMS, scopes: [] }
  }
}
