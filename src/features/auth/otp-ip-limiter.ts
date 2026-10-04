import { createHash } from 'node:crypto'

/** Codes one network (IP) may request per day through the app (Round 14, 1.1). */
export const OTP_CODES_PER_IP_PER_DAY = 20

type DynamoSend = (params: Record<string, unknown>) => Promise<unknown>

/**
 * Per-IP daily cap on phone codes, counted on the same DynamoDB table the Cognito create-challenge
 * Lambda uses for its per-number and global limits. The IP is hashed before it is stored. Without a
 * configured table (local development) every request is allowed.
 */
export function createOtpIpLimiter(input: {
  tableName?: string | null
  send?: DynamoSend
  now?: () => number
} = {}) {
  const tableName = input.tableName ?? process.env.OTP_LIMITS_TABLE ?? null
  const now = input.now ?? Date.now
  let sendPromise: Promise<DynamoSend> | null = input.send ? Promise.resolve(input.send) : null

  async function send(): Promise<DynamoSend> {
    sendPromise ??= import('@aws-sdk/client-dynamodb').then(({ DynamoDBClient, UpdateItemCommand }) => {
      const client = new DynamoDBClient({})
      return (params: Record<string, unknown>) => client.send(new UpdateItemCommand(params as never))
    })
    return sendPromise
  }

  return {
    /** True when this IP may request another code today. */
    async consume(ip: string | null): Promise<boolean> {
      if (!tableName || !ip) return true
      const nowSeconds = Math.floor(now() / 1000)
      const day = Math.floor(nowSeconds / 86400)
      const ipHash = createHash('sha256').update(`sea-n-shore-otp-ip:${ip}`).digest('hex').slice(0, 32)
      try {
        await (await send())({
          TableName: tableName,
          Key: { pk: { S: `otp#ip#${ipHash}#d#${day}` } },
          UpdateExpression: 'ADD n :one SET expiresAt = if_not_exists(expiresAt, :expires)',
          ConditionExpression: 'attribute_not_exists(n) OR n < :max OR expiresAt < :now',
          ExpressionAttributeValues: {
            ':one': { N: '1' },
            ':max': { N: String(OTP_CODES_PER_IP_PER_DAY) },
            ':now': { N: String(nowSeconds) },
            ':expires': { N: String(nowSeconds + 86400) },
          },
        })
        return true
      } catch (error) {
        if ((error as { name?: string })?.name === 'ConditionalCheckFailedException') return false
        // The Lambda still enforces per-number and global limits; do not block on our counter.
        console.error('otp_ip_limiter_unavailable', { name: (error as { name?: string })?.name ?? 'Error' })
        return true
      }
    },
  }
}
