import { describe, expect, it } from 'vitest'
import { accessTokenClaims, resolveDeletionReauth } from './reauth'

const NOW = new Date('2026-09-28T10:00:00.000Z')
const phoneEmail = 'phone-0123456789abcdef0123456789abcdef@auth.seaandshore.in'

function token(claims: Record<string, unknown>) {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
}

describe('choosing how a member confirms deletion', () => {
  it('uses the password for email sign-ins', () => {
    expect(resolveDeletionReauth({
      identity: { email: 'meera@example.com', providerUsername: 'uuid-1' },
      sessionEmail: 'meera@example.com', sessionUsername: 'uuid-1', authTime: null, now: NOW,
    })).toEqual({ method: 'password' })
  })

  // Rewritten in Round 15: SMS codes are retired, so a legacy mobile-only sign-in (synthetic
  // email, no password the member knows) can no longer confirm deletion itself.
  it('offers no self-service check to legacy mobile-only sign-ins (SMS codes are retired)', () => {
    expect(resolveDeletionReauth({
      identity: { email: phoneEmail, providerUsername: 'phone-user' },
      sessionEmail: phoneEmail, sessionUsername: 'phone-user', authTime: null, now: NOW,
    })).toEqual({ method: 'unavailable' })
    expect(resolveDeletionReauth({
      identity: null,
      sessionEmail: phoneEmail, sessionUsername: 'phone-user', authTime: null, now: NOW,
    })).toEqual({ method: 'unavailable' })
  })

  it('needs a Google sign-in within the last 10 minutes for Google members', () => {
    const identity = { email: 'meera@gmail.com', providerUsername: 'Google_1234' }
    expect(resolveDeletionReauth({ identity, sessionEmail: 'meera@gmail.com', sessionUsername: 'Google_1234', authTime: new Date(NOW.getTime() - 9 * 60_000), now: NOW }))
      .toEqual({ method: 'recent_sign_in', username: 'Google_1234', fresh: true })
    expect(resolveDeletionReauth({ identity, sessionEmail: 'meera@gmail.com', sessionUsername: 'Google_1234', authTime: new Date(NOW.getTime() - 11 * 60_000), now: NOW }))
      .toEqual({ method: 'recent_sign_in', username: 'Google_1234', fresh: false })
    expect(resolveDeletionReauth({ identity, sessionEmail: 'meera@gmail.com', sessionUsername: null, authTime: null, now: NOW }))
      .toMatchObject({ fresh: false })
  })

  it('reads auth_time and username from the access token', () => {
    expect(accessTokenClaims(token({ auth_time: 1790000000, username: 'Google_1' }))).toEqual({ authTime: new Date(1790000000 * 1000), username: 'Google_1' })
    expect(accessTokenClaims('not-a-token')).toEqual({ authTime: null, username: null })
    expect(accessTokenClaims(null)).toEqual({ authTime: null, username: null })
  })
})
