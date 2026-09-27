/**
 * Razorpay configuration. Server only: the key secret and webhook secret must never
 * reach the browser. Two ways to configure it, checked in this order:
 *
 * 1. Environment variables (ECS task `secrets` injected from AWS Secrets Manager,
 *    or a local .env for development):
 *      RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 * 2. One JSON secret in AWS Secrets Manager, read at runtime with the task role
 *    (same approach as AURORA_SECRET_ARN in src/lib/db/client.ts):
 *      PAYMENTS_RAZORPAY_SECRET_ARN = arn or name of a secret whose value is
 *      {"key_id":"rzp_live_…","key_secret":"…","webhook_secret":"…"}
 *
 * When neither is complete, payments are "not configured": paid events can still be
 * created, but registration for them stays closed with a clear message.
 */

export type RazorpayConfig = {
  keyId: string
  keySecret: string
  webhookSecret: string
}

type Environment = Record<string, string | undefined>
type SecretLoader = (secretId: string) => Promise<string | null>

const CACHE_TTL_MS = 5 * 60_000
/** Retry sooner when Secrets Manager could not be reached. */
const RETRY_TTL_MS = 30_000

let cached: { value: RazorpayConfig | null; expiresAt: number } | null = null

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function complete(input: { keyId: unknown; keySecret: unknown; webhookSecret: unknown }): RazorpayConfig | null {
  const keyId = clean(input.keyId)
  const keySecret = clean(input.keySecret)
  const webhookSecret = clean(input.webhookSecret)
  if (!keyId || !keySecret || !webhookSecret) return null
  if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) return null
  return { keyId, keySecret, webhookSecret }
}

export function razorpayConfigFromEnvironment(environment: Environment = process.env): RazorpayConfig | null {
  return complete({
    keyId: environment.RAZORPAY_KEY_ID,
    keySecret: environment.RAZORPAY_KEY_SECRET,
    webhookSecret: environment.RAZORPAY_WEBHOOK_SECRET,
  })
}

export function razorpayConfigFromSecretString(secretString: string | null): RazorpayConfig | null {
  if (!secretString) return null
  try {
    const parsed = JSON.parse(secretString) as Record<string, unknown>
    return complete({
      keyId: parsed.key_id ?? parsed.keyId,
      keySecret: parsed.key_secret ?? parsed.keySecret,
      webhookSecret: parsed.webhook_secret ?? parsed.webhookSecret,
    })
  } catch {
    return null
  }
}

async function loadSecretFromSecretsManager(secretId: string): Promise<string | null> {
  const { GetSecretValueCommand, SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager')
  const client = new SecretsManagerClient({})
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
  return response.SecretString ?? null
}

export async function loadRazorpayConfig(options: {
  environment?: Environment
  loadSecret?: SecretLoader
  now?: () => number
  useCache?: boolean
} = {}): Promise<RazorpayConfig | null> {
  const environment = options.environment ?? process.env
  const now = options.now ?? Date.now
  const useCache = options.useCache ?? true
  if (useCache && cached && cached.expiresAt > now()) return cached.value

  let value = razorpayConfigFromEnvironment(environment)
  let ttl = CACHE_TTL_MS
  const secretId = clean(environment.PAYMENTS_RAZORPAY_SECRET_ARN)
  if (!value && secretId) {
    try {
      value = razorpayConfigFromSecretString(await (options.loadSecret ?? loadSecretFromSecretsManager)(secretId))
      if (!value) console.error('payments_razorpay_secret_incomplete')
    } catch (error) {
      console.error('payments_razorpay_secret_unavailable', {
        message: error instanceof Error ? error.name : null,
      })
      value = null
      ttl = RETRY_TTL_MS
    }
  }

  if (useCache) cached = { value, expiresAt: now() + ttl }
  return value
}

export function resetRazorpayConfigCache() {
  cached = null
}
