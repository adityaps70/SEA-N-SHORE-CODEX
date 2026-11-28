import { createHmac } from 'node:crypto'

/**
 * RFC 6238 authenticator codes (SHA-1, 30-second steps, 6 digits: what Cognito software tokens use), so a staging
 * browser E2E can turn on two-step verification for a disposable administrator the way a person would with an
 * authenticator app. The secret is the base32 setup key the app shows; spaces are ignored.
 */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const TOTP_STEP_SECONDS = 30

export function base32Decode(input) {
  const clean = String(input ?? '').replace(/[\s=]/g, '').toUpperCase()
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error('The authenticator setup key is not base32.')
  let bits = 0
  let value = 0
  const bytes = []
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char)
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

export function totpCode(secret, { now = Date.now(), digits = 6, key } = {}) {
  const keyBytes = key ?? base32Decode(secret)
  const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', keyBytes).update(message).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** A code with at least `minSecondsLeft` of its step left, waiting for the next step when it is too close. */
export async function freshTotpCode(secret, { minSecondsLeft = 8, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const left = TOTP_STEP_SECONDS - ((now() / 1000) % TOTP_STEP_SECONDS)
  if (left < minSecondsLeft) await sleep(Math.ceil(left * 1000) + 250)
  return totpCode(secret, { now: now() })
}
