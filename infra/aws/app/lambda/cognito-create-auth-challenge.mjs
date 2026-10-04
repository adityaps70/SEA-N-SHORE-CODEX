// Phone sign-in OTP: Cognito calls this for every custom-auth challenge, including direct
// InitiateAuth calls that bypass the app, so the SMS abuse limits live here (Round 14, 1.1):
// an allowed-country list, a 45 s cooldown, 5 codes per number per hour, 10 per day (3 for a
// number that was never verified), and a global hourly cap that is logged for an alarm. A wrong
// answer reuses the session's code instead of texting a new one. Limits are counted in DynamoDB
// with TTL; if the limiter is unavailable the code is not sent (fail closed: SMS costs money and
// email and Google sign-in remain available).
import { randomInt } from 'node:crypto'

const SNS_MODULE = '@aws-sdk/client-sns'
const DYNAMODB_MODULE = '@aws-sdk/client-dynamodb'

export const OTP_LIMITS = Object.freeze({
  cooldownSeconds: 45,
  perNumberPerHour: 5,
  perNumberPerDay: 10,
  unverifiedPerNumberPerDay: 3,
  globalPerHour: 300,
})

export class OtpRefusedError extends Error {
  constructor(code) {
    super(code)
    this.name = 'OtpRefusedError'
  }
}

function log(fields) {
  console.log(JSON.stringify({ service: 'cognito-create-auth-challenge', ...fields }))
}

/** Calling codes (digits after "+") allowed to receive codes, from ALLOWED_PHONE_CALLING_CODES. */
export function allowedCallingCodes(environment = process.env) {
  const raw = String(environment.ALLOWED_PHONE_CALLING_CODES ?? '91')
  return raw.split(',').map((code) => code.trim().replace(/^\+/, '')).filter((code) => /^\d{1,3}$/.test(code))
}

export function isAllowedPhoneNumber(phoneNumber, codes) {
  if (typeof phoneNumber !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phoneNumber)) return false
  return codes.some((code) => phoneNumber.startsWith('+' + code))
}

async function defaultSns() {
  const { PublishCommand, SNSClient } = await import(SNS_MODULE)
  const client = new SNSClient({})
  return {
    sendSms: (phoneNumber, message) => client.send(new PublishCommand({
      PhoneNumber: phoneNumber,
      Message: message,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    })),
  }
}

/** Counters on one DynamoDB table (pk string, expiresAt epoch seconds as the TTL attribute). */
export function createDynamoLimiter(input) {
  let clientPromise = input.client ? Promise.resolve(input.client) : null
  async function client() {
    clientPromise ??= import(DYNAMODB_MODULE).then(({ DynamoDBClient, UpdateItemCommand }) => {
      const dynamo = new DynamoDBClient({})
      return { send: (params) => dynamo.send(new UpdateItemCommand(params)) }
    })
    return clientPromise
  }
  function conditionFailed(error) {
    return error?.name === 'ConditionalCheckFailedException'
  }
  return {
    /** Adds one to a windowed counter; false when it is already at `max`. */
    async increment(key, max, windowSeconds, nowSeconds) {
      try {
        await (await client()).send({
          TableName: input.tableName,
          Key: { pk: { S: key } },
          UpdateExpression: 'ADD n :one SET expiresAt = if_not_exists(expiresAt, :expires)',
          ConditionExpression: 'attribute_not_exists(n) OR n < :max OR expiresAt < :now',
          ExpressionAttributeValues: {
            ':one': { N: '1' },
            ':max': { N: String(max) },
            ':now': { N: String(nowSeconds) },
            ':expires': { N: String(nowSeconds + windowSeconds) },
          },
        })
        return true
      } catch (error) {
        if (conditionFailed(error)) return false
        throw error
      }
    },
    /** Starts a cooldown; false while a previous one is still running. */
    async cooldown(key, seconds, nowSeconds) {
      try {
        await (await client()).send({
          TableName: input.tableName,
          Key: { pk: { S: key } },
          UpdateExpression: 'SET expiresAt = :expires',
          ConditionExpression: 'attribute_not_exists(expiresAt) OR expiresAt <= :now',
          ExpressionAttributeValues: {
            ':now': { N: String(nowSeconds) },
            ':expires': { N: String(nowSeconds + seconds) },
          },
        })
        return true
      } catch (error) {
        if (conditionFailed(error)) return false
        throw error
      }
    },
  }
}

/** Throws OtpRefusedError when this number may not get a new code now. */
export async function enforceOtpLimits(input) {
  const { limiter, phoneNumber, verified, nowSeconds } = input
  const hour = Math.floor(nowSeconds / 3600)
  const day = Math.floor(nowSeconds / 86400)
  if (!await limiter.cooldown(`otp#cool#${phoneNumber}`, OTP_LIMITS.cooldownSeconds, nowSeconds)) {
    throw new OtpRefusedError('otp_cooldown')
  }
  if (!await limiter.increment(`otp#num#${phoneNumber}#h#${hour}`, OTP_LIMITS.perNumberPerHour, 3600, nowSeconds)) {
    throw new OtpRefusedError('otp_rate_limited')
  }
  const perDay = verified ? OTP_LIMITS.perNumberPerDay : OTP_LIMITS.unverifiedPerNumberPerDay
  if (!await limiter.increment(`otp#num#${phoneNumber}#d#${day}`, perDay, 86400, nowSeconds)) {
    throw new OtpRefusedError('otp_rate_limited')
  }
  if (!await limiter.increment(`otp#global#h#${hour}`, OTP_LIMITS.globalPerHour, 3600, nowSeconds)) {
    log({ outcome: 'otp_global_cap_reached', hour })
    throw new OtpRefusedError('otp_rate_limited')
  }
}

function previousCode(event) {
  const session = Array.isArray(event.request?.session) ? event.request.session : []
  for (let index = session.length - 1; index >= 0; index -= 1) {
    const match = /^PHONE_OTP:(\d{6})$/.exec(String(session[index]?.challengeMetadata ?? ''))
    if (match) return match[1]
  }
  return null
}

export function createHandler(input = {}) {
  const environment = input.environment ?? process.env
  const now = input.now ?? Date.now
  let snsClient = input.sns ? Promise.resolve(input.sns) : null
  const sns = () => (snsClient ??= defaultSns())
  const limiter = input.limiter ?? createDynamoLimiter({ tableName: environment.OTP_LIMITS_TABLE })

  return async function handler(event) {
    const phoneNumber = event.request?.userAttributes?.phone_number
    if (typeof phoneNumber !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
      throw new Error('phone_number_required')
    }

    // A wrong answer in the same sign-in: ask again with the code already sent (no new SMS).
    const reused = previousCode(event)
    let code = reused
    if (!code) {
      if (!isAllowedPhoneNumber(phoneNumber, allowedCallingCodes(environment))) {
        log({ outcome: 'refused', reason: 'otp_country_not_allowed' })
        throw new OtpRefusedError('otp_country_not_allowed')
      }
      try {
        await enforceOtpLimits({
          limiter,
          phoneNumber,
          verified: event.request?.userAttributes?.phone_number_verified === 'true',
          nowSeconds: Math.floor(now() / 1000),
        })
      } catch (error) {
        if (error instanceof OtpRefusedError) {
          log({ outcome: 'refused', reason: error.message })
          throw error
        }
        log({ outcome: 'refused', reason: 'otp_limiter_unavailable' })
        throw new OtpRefusedError('otp_limiter_unavailable')
      }
      code = String(randomInt(100000, 1000000))
      await (await sns()).sendSms(phoneNumber, `Your Sea N Shore verification code is ${code}. It expires shortly. Do not share this code.`)
      log({ outcome: 'sent' })
    }

    event.response.publicChallengeParameters = { delivery: 'sms' }
    event.response.privateChallengeParameters = { answer: code }
    // Only the auth Lambdas see challengeMetadata; it lets a retry reuse the code.
    event.response.challengeMetadata = `PHONE_OTP:${code}`
    return event
  }
}

export const handler = createHandler()
