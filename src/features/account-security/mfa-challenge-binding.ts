import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Round H (H3): the MFA challenge cookies (Cognito session + username) are set by the server after a correct
 * password, but a browser could overwrite them. This keyed signature over both is set next to them, so the backup
 * code step only ever checks codes for the member whose password step just succeeded in this browser.
 */
function signature(key: Buffer, challenge: { session: string; username: string }) {
  const sessionDigest = createHash('sha256').update(challenge.session).digest('hex')
  return createHmac('sha256', key).update(`mfa-challenge:${challenge.username}\n${sessionDigest}`).digest('hex')
}

export function signMfaChallenge(key: Buffer | null, challenge: { session: string; username: string }) {
  return key ? signature(key, challenge) : null
}

export function verifyMfaChallengeBinding(
  key: Buffer | null,
  challenge: { session: string; username: string; binding: string | null | undefined },
) {
  if (!key || !challenge.binding || !/^[0-9a-f]{64}$/.test(challenge.binding)) return false
  const expected = Buffer.from(signature(key, challenge), 'hex')
  const actual = Buffer.from(challenge.binding, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
