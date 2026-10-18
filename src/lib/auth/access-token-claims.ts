/**
 * Round H (H3): reads claims from a Cognito access token WITHOUT verifying it. Only call this on a token Cognito has
 * just accepted (GetUser answered for it), so the claims are ones Cognito vouched for.
 *
 * `origin_jti` identifies the sign-in the token came from: it stays the same when the token is refreshed, and a new
 * sign-in gets a new one. Sea N Shore keys each signed-in device (public.auth_sessions) on it.
 */
export type AccessTokenClaims = {
  originJti: string | null
  scopes: string[]
}

export function decodeAccessTokenClaims(accessToken: string): AccessTokenClaims {
  const payload = accessToken.split('.')[1]
  if (!payload) return { originJti: null, scopes: [] }
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : ''
    const decoded = JSON.parse(atob(normalized + padding)) as { origin_jti?: unknown; scope?: unknown }
    const originJti = typeof decoded.origin_jti === 'string' && /^[A-Za-z0-9-]{8,128}$/.test(decoded.origin_jti)
      ? decoded.origin_jti
      : null
    const scopes = typeof decoded.scope === 'string' ? decoded.scope.split(/\s+/).filter(Boolean) : []
    return { originJti, scopes }
  } catch {
    return { originJti: null, scopes: [] }
  }
}
