import { CognitoApiError, type CognitoPrincipal } from './cognito-api'

type GetUser = (accessToken: string) => Promise<CognitoPrincipal>

type ResolverOptions = {
  getUser: GetUser
  now?: () => number
  cacheTtlMs?: number
  maxEntries?: number
}

type CacheEntry = {
  principal: CognitoPrincipal
  expiresAt: number
  lastUsedAt: number
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
const FALLBACK_CACHE_TTL_MS = 60 * 1000
const TOKEN_EXPIRY_SKEW_MS = 5 * 1000
const DEFAULT_MAX_ENTRIES = 256

function tokenExpiryMs(accessToken: string): number | null {
  const payload = accessToken.split('.')[1]
  if (!payload) return null

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4
      ? '='.repeat(4 - (normalized.length % 4))
      : ''
    const decoded = JSON.parse(atob(normalized + padding)) as { exp?: unknown }
    return typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)
      ? decoded.exp * 1000
      : null
  } catch {
    return null
  }
}

function isAuthorizationFailure(error: unknown) {
  return error instanceof CognitoApiError && error.code === 'NotAuthorizedException'
}

export function createCognitoPrincipalResolver(options: ResolverOptions) {
  const now = options.now ?? Date.now
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const verified = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<CognitoPrincipal | null>>()

  function prune(timestamp: number) {
    for (const [token, entry] of verified) {
      if (entry.expiresAt <= timestamp) verified.delete(token)
    }

    while (verified.size >= maxEntries) {
      let oldestToken: string | null = null
      let oldestUsedAt = Number.POSITIVE_INFINITY
      for (const [token, entry] of verified) {
        if (entry.lastUsedAt < oldestUsedAt) {
          oldestToken = token
          oldestUsedAt = entry.lastUsedAt
        }
      }
      if (!oldestToken) break
      verified.delete(oldestToken)
    }
  }

  return async function resolveCognitoPrincipal(accessToken: string): Promise<CognitoPrincipal | null> {
    const timestamp = now()
    const cached = verified.get(accessToken)
    if (cached && cached.expiresAt > timestamp) {
      cached.lastUsedAt = timestamp
      return cached.principal
    }
    if (cached) verified.delete(accessToken)

    const pending = inFlight.get(accessToken)
    if (pending) return pending

    const verification = (async () => {
      try {
        const principal = await options.getUser(accessToken)
        if (!principal.sub) return null

        const verifiedAt = now()
        const tokenExpiresAt = tokenExpiryMs(accessToken)
        const fallbackExpiresAt = verifiedAt + Math.min(cacheTtlMs, FALLBACK_CACHE_TTL_MS)
        const expiresAt = tokenExpiresAt == null
          ? fallbackExpiresAt
          : Math.min(verifiedAt + cacheTtlMs, tokenExpiresAt - TOKEN_EXPIRY_SKEW_MS)

        if (expiresAt > verifiedAt) {
          prune(verifiedAt)
          verified.set(accessToken, {
            principal,
            expiresAt,
            lastUsedAt: verifiedAt,
          })
        }

        return principal
      } catch (error) {
        verified.delete(accessToken)
        if (isAuthorizationFailure(error)) return null
        throw error
      } finally {
        inFlight.delete(accessToken)
      }
    })()

    inFlight.set(accessToken, verification)
    return verification
  }
}
