import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Resend delivery webhooks (sent through Svix). The signing secret is created by Resend when the webhook is created
 * (scripts/aws/resend-delivery-webhook.sh) and stored in Secrets Manager as "sea-n-shore/resend-webhook-signing",
 * which the existing "sea-n-shore/resend*" runtime grant already covers. It never enters Terraform state or logs.
 */
export const DEFAULT_RESEND_WEBHOOK_SECRET_ID = 'sea-n-shore/resend-webhook-signing'

/** Svix's timestamp tolerance: deliveries signed more than 5 minutes away from now are refused (replays). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60

type Environment = Record<string, string | undefined>
type SecretLoader = (secretId: string) => Promise<string | null>

const CACHE_TTL_MS = 5 * 60_000
const RETRY_TTL_MS = 30_000

let cachedSecret: { value: string | null; expiresAt: number } | null = null

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function plausibleSecret(value: unknown) {
  const secret = clean(value)
  return /^whsec_[A-Za-z0-9+/=]{16,}$/.test(secret) ? secret : null
}

/** Accepts the bare "whsec_…" value or a JSON object with `signing_secret`. */
export function webhookSecretFromSecretString(secretString: string | null) {
  const raw = clean(secretString)
  if (!raw) return null
  const direct = plausibleSecret(raw)
  if (direct) return direct
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return plausibleSecret(parsed.signing_secret ?? parsed.signingSecret)
  } catch {
    return null
  }
}

export function resendWebhookSecretId(environment: Environment = process.env) {
  const explicit = clean(environment.RESEND_WEBHOOK_SECRET_ID)
  if (explicit) return explicit
  return environment.NODE_ENV === 'production' ? DEFAULT_RESEND_WEBHOOK_SECRET_ID : null
}

async function loadSecretFromSecretsManager(secretId: string) {
  const { GetSecretValueCommand, SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager')
  const client = new SecretsManagerClient({})
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
  return response.SecretString ?? null
}

export async function loadResendWebhookSecret(options: {
  environment?: Environment
  loadSecret?: SecretLoader
  now?: () => number
  useCache?: boolean
} = {}) {
  const environment = options.environment ?? process.env
  const fromEnvironment = plausibleSecret(environment.RESEND_WEBHOOK_SECRET)
  if (fromEnvironment) return fromEnvironment

  const secretId = resendWebhookSecretId(environment)
  if (!secretId) return null

  const now = options.now ?? Date.now
  const useCache = options.useCache ?? true
  if (useCache && cachedSecret && cachedSecret.expiresAt > now()) return cachedSecret.value

  try {
    const value = webhookSecretFromSecretString(await (options.loadSecret ?? loadSecretFromSecretsManager)(secretId))
    if (!value) console.error('resend_webhook_secret_incomplete')
    if (useCache) cachedSecret = { value, expiresAt: now() + (value ? CACHE_TTL_MS : RETRY_TTL_MS) }
    return value
  } catch (error) {
    // Until the webhook is created the secret does not exist; retry soon rather than caching the miss for long.
    console.error('resend_webhook_secret_unavailable', { name: error instanceof Error ? error.name : null })
    if (useCache) cachedSecret = { value: null, expiresAt: now() + RETRY_TTL_MS }
    return null
  }
}

export function resetResendWebhookSecretCache() {
  cachedSecret = null
}

export type WebhookVerification = { ok: true } | { ok: false; reason: 'missing_headers' | 'stale_timestamp' | 'bad_signature' }

/**
 * Svix signature check: HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<raw body>" keyed with the base64 part of the
 * "whsec_" secret; `svix-signature` is a space-separated list of "v1,<base64>" and any one match is enough. Compared
 * in constant time. The raw body must be the exact bytes received (never re-serialised JSON).
 */
export function verifyResendWebhook(input: {
  secret: string
  id: string | null
  timestamp: string | null
  signature: string | null
  body: string
  nowSeconds?: number
  toleranceSeconds?: number
}): WebhookVerification {
  const id = clean(input.id)
  const timestamp = clean(input.timestamp)
  const signature = clean(input.signature)
  if (!id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'missing_headers' }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS
  if (Math.abs(now - Number(timestamp)) > tolerance) return { ok: false, reason: 'stale_timestamp' }

  const secret = plausibleSecret(input.secret)
  if (!secret) return { ok: false, reason: 'bad_signature' }
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${input.body}`).digest()

  for (const part of signature.split(' ')) {
    const [version, value] = part.split(',', 2)
    if (version !== 'v1' || !value) continue
    const candidate = Buffer.from(value, 'base64')
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return { ok: true }
  }
  return { ok: false, reason: 'bad_signature' }
}

/** Test helper and the ops runner's self-check: signs a body the way Svix does. */
export function signResendWebhook(input: { secret: string; id: string; timestamp: number; body: string }) {
  const key = Buffer.from(input.secret.slice('whsec_'.length), 'base64')
  return 'v1,' + createHmac('sha256', key).update(`${input.id}.${input.timestamp}.${input.body}`).digest('base64')
}
