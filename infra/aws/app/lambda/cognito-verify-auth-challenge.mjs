import { timingSafeEqual } from 'node:crypto'

function equalCode(expected, actual) {
  if (!/^\d{6}$/.test(expected) || !/^\d{6}$/.test(actual)) return false
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  return expectedBuffer.length === actualBuffer.length
    && timingSafeEqual(expectedBuffer, actualBuffer)
}

export async function handler(event) {
  const expected = String(event.request?.privateChallengeParameters?.answer ?? '')
  const actual = String(event.request?.challengeAnswer ?? '')
  event.response.answerCorrect = equalCode(expected, actual)
  return event
}
