import { randomInt } from 'node:crypto'
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'

const sns = new SNSClient({})

export async function handler(event) {
  const phoneNumber = event.request?.userAttributes?.phone_number
  if (typeof phoneNumber !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    throw new Error('phone_number_required')
  }

  const code = String(randomInt(100000, 1000000))
  await sns.send(new PublishCommand({
    PhoneNumber: phoneNumber,
    Message: `Your Sea N Shore verification code is ${code}. It expires shortly. Do not share this code.`,
  }))

  event.response.publicChallengeParameters = {
    delivery: 'sms',
  }
  event.response.privateChallengeParameters = {
    answer: code,
  }
  event.response.challengeMetadata = 'PHONE_OTP'
  return event
}
