import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { CognitoApiError, type CognitoAuthenticationResult } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { createCognitoSessionManager } from '@/lib/auth/cognito-session'
import { createRefreshSingleFlight, type RefreshRenewal } from '@/lib/auth/refresh-single-flight'
import { deriveAccountSecurityKey } from './keys'
import { createRefreshRenewalStore } from './refresh-renewals'
import { createRefreshTokenLedger } from './refresh-token-ledger'
import type { AccountQuery } from './types'

/**
 * Owner (15 Nov): an administrator using a phone and a laptop was signed out when moving between them.
 *
 * A fake Cognito with refresh token rotation and the 60-second retry grace, behaving as captured from real Cognito
 * (ministack#2593): a retry of t1 within the grace returns a NEW t3, and the t2 issued before it is refused with
 * RefreshTokenReuseException from then on. Each device is a browser cookie jar: a request carries the jar's cookies
 * as they were when it was sent, and the jar applies its Set-Cookie when the response arrives. A device opened again
 * after its 60-minute access cookie expired sends several requests at once, spread over two servers, and their
 * responses arrive in reverse order. Placeholder tokens only; the shared store and the ledger run on PGlite.
 */
let db: TestDatabase
const query: AccountQuery = (text, values) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
const key = deriveAccountSecurityKey('placeholder-server-secret-that-is-long-enough-1234', 'refresh-renewal')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const GRACE_MS = 60_000

function fakeCognito(clock: { now: number }) {
  let next = 0
  type Token = { family: string; state: 'current' | 'rotated' | 'refused'; rotatedAt?: number; child?: string }
  const tokens = new Map<string, Token>()
  const issue = (family: string) => {
    const token = `${family}-r${next++}`
    tokens.set(token, { family, state: 'current' })
    return token
  }
  const calls = { refresh: 0 }
  return {
    calls,
    signIn: issue,
    async refresh(refreshToken: string): Promise<CognitoAuthenticationResult> {
      calls.refresh += 1
      const token = tokens.get(refreshToken)
      if (!token || token.state === 'refused') throw new CognitoApiError('RefreshTokenReuseException')
      if (token.state === 'rotated') {
        if (clock.now - token.rotatedAt! > GRACE_MS) throw new CognitoApiError('RefreshTokenReuseException')
        // A retry within the grace: a newer token, and the one issued before it stops working.
        const previous = tokens.get(token.child!)
        if (previous) previous.state = 'refused'
      } else {
        token.state = 'rotated'
        token.rotatedAt = clock.now
      }
      const child = issue(token.family)
      token.child = child
      await new Promise((resolve) => setTimeout(resolve, 2))
      // A JWT-shaped access token whose origin_jti names the sign-in, as the ledger reads it.
      const claims = Buffer.from(JSON.stringify({ origin_jti: `origin-${token.family}`, scope: 'aws.cognito.signin.user.admin' })).toString('base64url')
      return { accessToken: `eyJhbGciOiJub25lIn0.${claims}.${child}`, refreshToken: child, expiresIn: 3600 }
    },
  }
}

type Cognito = ReturnType<typeof fakeCognito>
type Server = { renew?: RefreshRenewal }

async function request(jar: Map<string, string>, cognito: Cognito, server: Server) {
  const sent = new Map(jar)
  const changes: Array<[string, string | null]> = []
  const manager = createCognitoSessionManager({
    cookieStore: {
      get: (name) => (sent.has(name) ? { name, value: sent.get(name)! } : undefined),
      set: (name, value) => {
        sent.set(name, value)
        changes.push([name, value])
      },
      delete: (name) => {
        sent.delete(name)
        changes.push([name, null])
      },
    },
    api: { getUser: async () => ({ sub: 'placeholder-sub', email: null, emailVerified: true, name: null }), refresh: cognito.refresh },
    siteUrl: 'https://example.test',
    ledger: createRefreshTokenLedger({ query, warn: () => undefined }),
    renew: server.renew,
  })
  const renewed = await manager.refreshSession()
  return {
    renewed,
    apply: () => {
      for (const [name, value] of changes) {
        if (value === null) jar.delete(name)
        else jar.set(name, value)
      }
    },
  }
}

async function wake(jar: Map<string, string>, cognito: Cognito, servers: Server[], parallel: number) {
  jar.delete(COGNITO_COOKIE_NAMES.access)
  const results = await Promise.all(Array.from({ length: parallel }, (_, i) => request(jar, cognito, servers[i % servers.length]!)))
  for (const result of [...results].reverse()) result.apply()
  return results.every((result) => result.renewed) && jar.has(COGNITO_COOKIE_NAMES.refresh)
}

async function phoneAndLaptop(servers: Server[]) {
  const clock = { now: 0 }
  const cognito = fakeCognito(clock)
  const laptop = new Map([[COGNITO_COOKIE_NAMES.refresh, cognito.signIn('laptop')]])
  const phone = new Map([[COGNITO_COOKIE_NAMES.refresh, cognito.signIn('phone')]])
  const signedIn: string[] = []
  for (let round = 0; round < 4; round += 1) {
    clock.now += 61 * 60_000
    signedIn.push(`phone ${round} ${await wake(phone, cognito, servers, 3)}`)
    clock.now += 61 * 60_000
    signedIn.push(`laptop ${round} ${await wake(laptop, cognito, servers, 2)}`)
  }
  return { signedIn, cognito }
}

describe('two devices of one member stay signed in side by side', () => {
  it('phone and laptop, each opened again after an hour with requests in parallel over two servers', async () => {
    const shared = createRefreshRenewalStore({ query, key, schedule: () => undefined })
    expect(shared).toBeDefined()
    const servers = [{ renew: createRefreshSingleFlight({ shared }) }, { renew: createRefreshSingleFlight({ shared }) }]
    const { signedIn, cognito } = await phoneAndLaptop(servers)
    expect(signedIn).toEqual([
      'phone 0 true', 'laptop 0 true', 'phone 1 true', 'laptop 1 true',
      'phone 2 true', 'laptop 2 true', 'phone 3 true', 'laptop 3 true',
    ])
    // One Cognito renewal per wake, whichever server each request reached.
    expect(cognito.calls.refresh).toBe(8)
    expect(await db.query(`select 1 from public.auth_sessions where reuse_detected_at is not null`)).toHaveLength(0)
  })

  it('without one renewal per token (as before this change) the phone is signed out on its second wake', async () => {
    const { signedIn } = await phoneAndLaptop([{}, {}])
    expect(signedIn.slice(0, 3)).toEqual(['phone 0 true', 'laptop 0 true', 'phone 1 false'])
  })
})
