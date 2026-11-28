import assert from 'node:assert/strict'
import test from 'node:test'
import { base32Decode, freshTotpCode, totpCode } from './e2e-totp.mjs'

// RFC 6238 appendix B, SHA-1 seed "12345678901234567890" (base32 below), 8 digits.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const RFC_VECTORS = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
]

test('base32 setup keys decode, spaces and case ignored', () => {
  assert.equal(base32Decode(RFC_SECRET).toString('utf8'), '12345678901234567890')
  assert.equal(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').toString('utf8'), '12345678901234567890')
  assert.throws(() => base32Decode('not base32!'), /not base32/)
  assert.throws(() => base32Decode(''), /not base32/)
})

test('codes match the RFC 6238 SHA-1 test vectors', () => {
  for (const [seconds, expected] of RFC_VECTORS) {
    assert.equal(totpCode(RFC_SECRET, { now: seconds * 1000, digits: 8 }), expected, `T=${seconds}`)
    assert.equal(totpCode(RFC_SECRET, { now: seconds * 1000 }), expected.slice(-6), `T=${seconds} (6 digits)`)
  }
})

test('a fresh code waits for the next step when the current one is about to end', async () => {
  let clock = 59_000 // 1 second left in the step
  const waits = []
  const code = await freshTotpCode(RFC_SECRET, { now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms } })
  assert.equal(waits.length, 1)
  assert.ok(waits[0] >= 1000 && waits[0] < 2000)
  assert.equal(code, totpCode(RFC_SECRET, { now: 61_000 }))

  clock = 31_000 // 29 seconds left: no wait
  waits.length = 0
  assert.equal(await freshTotpCode(RFC_SECRET, { now: () => clock, sleep: async (ms) => { waits.push(ms) } }), totpCode(RFC_SECRET, { now: 31_000 }))
  assert.equal(waits.length, 0)
})
