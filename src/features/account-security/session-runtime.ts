import { cookies, headers } from 'next/headers'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { query } from '@/lib/db/client'
import { cacheClearHub } from '@/lib/cache/runtime'
import { accountSecurityKey, hashSessionIp } from './keys'
import { sessionRequestContext } from './request-context'
import { createSessionControls } from './session-controls'
import { createSessionGuard, type SessionCheck } from './session-guard'
import { createSessionRepository } from './session-repository'

/** Round H (H3): the production session repository, guard and controls (one per server process). */
export const sessionRepository = createSessionRepository({ query: (text, values) => query(text, values) })

export const sessionGuard = createSessionGuard({
  repository: sessionRepository,
  hashIp: (ip) => hashSessionIp(ip, accountSecurityKey('session-ip')),
  clearHub: cacheClearHub,
})

export const sessionControls = createSessionControls({ repository: sessionRepository, guard: sessionGuard })

/** The session check for this request's access token (already verified by Cognito in getAwsVerifiedUser). */
export async function checkCurrentSession(profileId: string): Promise<SessionCheck> {
  const accessToken = (await cookies()).get(COGNITO_COOKIE_NAMES.access)?.value
  if (!accessToken) return { status: 'untracked' }
  return sessionGuard.check({
    accessToken,
    profileId,
    context: async () => sessionRequestContext(await headers()),
  })
}

/** This device's session id, or null when it is not tracked. */
export async function currentSessionId(profileId: string): Promise<string | null> {
  const check = await checkCurrentSession(profileId)
  return check.status === 'active' ? check.sessionId : null
}
