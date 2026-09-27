import type { CashfreeMode, PaymentProviderName } from './types'

/**
 * Cashfree configuration. Server only: secrets never reach the browser.
 * Checked in this order:
 *
 * 1. Environment variables (a local .env, or ECS task `secrets` once infra adds them):
 *      CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET          Payment Gateway API keys
 *      CASHFREE_ENVIRONMENT = sandbox | production         defaults to sandbox
 *      CASHFREE_INTERNATIONAL = true                       only if Cashfree enabled non-INR orders
 *      CASHFREE_PAYOUTS_CLIENT_ID, CASHFREE_PAYOUTS_CLIENT_SECRET, CASHFREE_PAYOUTS_PUBLIC_KEY (PEM)
 * 2. One JSON secret in AWS Secrets Manager, read at runtime with the ECS task role:
 *      secret id = PAYMENTS_CASHFREE_SECRET_ARN, or in production the default name
 *      "sea-n-shore/staging/cashfree". Value:
 *      {"client_id":"…","client_secret":"…","environment":"sandbox",
 *       "international":false,"provider":"cashfree",
 *       "payouts_client_id":"…","payouts_client_secret":"…","payouts_public_key":"-----BEGIN PUBLIC KEY-----…"}
 *
 * PAYMENTS_PROVIDER (env) or "provider" (secret) picks the gateway when both are set up.
 * Nothing here is required: with no keys, payments simply stay "not set up yet".
 */

export const DEFAULT_CASHFREE_SECRET_ID = 'sea-n-shore/staging/cashfree'

export type CashfreeConfig = {
  clientId: string
  clientSecret: string
  environment: CashfreeMode
  /** Cashfree accepts non-INR (USD) orders on this account. Off unless set explicitly. */
  international: boolean
}

/** Payouts use their own key pair (a different Cashfree product). Parsed here for the payouts module. */
export type CashfreePayoutsConfig = {
  clientId: string
  clientSecret: string
  /** RSA public key (PEM) for the x-cf-signature 2FA header, when IP whitelisting is not used. */
  publicKeyPem: string | null
  environment: CashfreeMode
}

export type CashfreeSettings = {
  pg: CashfreeConfig | null
  payouts: CashfreePayoutsConfig | null
  /** Gateway the owner asked for, if any. provider.ts decides what is actually used. */
  preferredProvider: PaymentProviderName | null
}

type Environment = Record<string, string | undefined>
type SecretLoader = (secretId: string) => Promise<string | null>

const CACHE_TTL_MS = 5 * 60_000
/** Retry sooner when Secrets Manager could not be reached. */
const RETRY_TTL_MS = 30_000
/** Errors that mean "no secret for us" rather than a temporary failure. */
const PERMANENT_SECRET_ERRORS = new Set(['ResourceNotFoundException', 'AccessDeniedException', 'AccessDenied'])

const EMPTY: CashfreeSettings = { pg: null, payouts: null, preferredProvider: null }

let cached: { value: CashfreeSettings; expiresAt: number } | null = null

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function flag(value: unknown) {
  if (value === true) return true
  return typeof value === 'string' && ['true', '1', 'yes'].includes(value.trim().toLowerCase())
}

/** sandbox (default when empty) or production; null for anything else. */
export function parseCashfreeEnvironment(value: unknown): CashfreeMode | null {
  const text = clean(value).toLowerCase()
  if (!text || text === 'sandbox' || text === 'test') return 'sandbox'
  if (text === 'production' || text === 'prod' || text === 'live') return 'production'
  return null
}

export function parseProviderPreference(value: unknown): PaymentProviderName | null {
  const text = clean(value).toLowerCase()
  return text === 'cashfree' || text === 'razorpay' ? text : null
}

function pgConfig(input: { clientId: unknown; clientSecret: unknown; environment: unknown; international: unknown }): CashfreeConfig | null {
  const clientId = clean(input.clientId)
  const clientSecret = clean(input.clientSecret)
  const environment = parseCashfreeEnvironment(input.environment)
  if (!clientId || !clientSecret) return null
  if (!environment) {
    console.error('payments_cashfree_environment_invalid')
    return null
  }
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(clientId)) return null
  return { clientId, clientSecret, environment, international: flag(input.international) }
}

function payoutsConfig(input: { clientId: unknown; clientSecret: unknown; publicKey: unknown; environment: CashfreeMode | null }): CashfreePayoutsConfig | null {
  const clientId = clean(input.clientId)
  const clientSecret = clean(input.clientSecret)
  if (!clientId || !clientSecret || !input.environment) return null
  const pem = clean(input.publicKey).replace(/\\n/g, '\n')
  return {
    clientId,
    clientSecret,
    publicKeyPem: pem.includes('BEGIN') ? pem : null,
    environment: input.environment,
  }
}

export function cashfreeSettingsFromEnvironment(environment: Environment = process.env): CashfreeSettings | null {
  const pg = pgConfig({
    clientId: environment.CASHFREE_CLIENT_ID,
    clientSecret: environment.CASHFREE_CLIENT_SECRET,
    environment: environment.CASHFREE_ENVIRONMENT,
    international: environment.CASHFREE_INTERNATIONAL,
  })
  const payouts = payoutsConfig({
    clientId: environment.CASHFREE_PAYOUTS_CLIENT_ID,
    clientSecret: environment.CASHFREE_PAYOUTS_CLIENT_SECRET,
    publicKey: environment.CASHFREE_PAYOUTS_PUBLIC_KEY,
    environment: parseCashfreeEnvironment(environment.CASHFREE_ENVIRONMENT),
  })
  if (!pg && !payouts) return null
  return { pg, payouts, preferredProvider: parseProviderPreference(environment.PAYMENTS_PROVIDER) }
}

export function cashfreeSettingsFromSecretString(secretString: string | null): CashfreeSettings {
  if (!secretString) return EMPTY
  try {
    const parsed = JSON.parse(secretString) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return EMPTY
    const environment = parsed.environment ?? parsed.cashfree_environment
    return {
      pg: pgConfig({
        clientId: parsed.client_id ?? parsed.clientId,
        clientSecret: parsed.client_secret ?? parsed.clientSecret,
        environment,
        international: parsed.international ?? parsed.cashfree_international,
      }),
      payouts: payoutsConfig({
        clientId: parsed.payouts_client_id,
        clientSecret: parsed.payouts_client_secret,
        publicKey: parsed.payouts_public_key,
        environment: parseCashfreeEnvironment(parsed.payouts_environment ?? environment),
      }),
      preferredProvider: parseProviderPreference(parsed.provider),
    }
  } catch {
    return EMPTY
  }
}

async function loadSecretFromSecretsManager(secretId: string): Promise<string | null> {
  const { GetSecretValueCommand, SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager')
  const client = new SecretsManagerClient({})
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
  return response.SecretString ?? null
}

/** The secret to read: the explicit ARN, else the default name in production only. */
export function cashfreeSecretId(environment: Environment = process.env) {
  const explicit = clean(environment.PAYMENTS_CASHFREE_SECRET_ARN)
  if (explicit) return explicit
  return environment.NODE_ENV === 'production' ? DEFAULT_CASHFREE_SECRET_ID : null
}

export async function loadCashfreeSettings(options: {
  environment?: Environment
  loadSecret?: SecretLoader
  now?: () => number
  useCache?: boolean
} = {}): Promise<CashfreeSettings> {
  const environment = options.environment ?? process.env
  const now = options.now ?? Date.now
  const useCache = options.useCache ?? true
  if (useCache && cached && cached.expiresAt > now()) return cached.value

  let value = cashfreeSettingsFromEnvironment(environment)
  let ttl = CACHE_TTL_MS
  const secretId = value?.pg ? null : cashfreeSecretId(environment)
  if (secretId) {
    try {
      const fromSecret = cashfreeSettingsFromSecretString(await (options.loadSecret ?? loadSecretFromSecretsManager)(secretId))
      if (!fromSecret.pg) console.error('payments_cashfree_secret_incomplete')
      value = {
        pg: fromSecret.pg,
        payouts: value?.payouts ?? fromSecret.payouts,
        preferredProvider: parseProviderPreference(environment.PAYMENTS_PROVIDER) ?? fromSecret.preferredProvider,
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : null
      console.error('payments_cashfree_secret_unavailable', { name })
      if (!name || !PERMANENT_SECRET_ERRORS.has(name)) ttl = RETRY_TTL_MS
    }
  }

  const settings = value ?? { ...EMPTY, preferredProvider: parseProviderPreference(environment.PAYMENTS_PROVIDER) }
  if (useCache) cached = { value: settings, expiresAt: now() + ttl }
  return settings
}

export async function loadCashfreeConfig(options?: Parameters<typeof loadCashfreeSettings>[0]) {
  return (await loadCashfreeSettings(options)).pg
}

/** For the payouts module: separate Payouts API keys, or null when not set up. */
export async function loadCashfreePayoutsConfig(options?: Parameters<typeof loadCashfreeSettings>[0]) {
  return (await loadCashfreeSettings(options)).payouts
}

export function resetCashfreeConfigCache() {
  cached = null
}
