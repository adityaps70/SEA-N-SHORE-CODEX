export const DEFAULT_RESEND_SECRET_ID = 'sea-n-shore/resend'

type Environment = Record<string, string | undefined>
type SecretLoader = (secretId: string) => Promise<string | null>
type FetchLike = (input: string, init: RequestInit) => Promise<Response>

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 5 * 60_000
const RETRY_TTL_MS = 30_000
const PERMANENT_SECRET_ERRORS = new Set(['ResourceNotFoundException', 'AccessDeniedException', 'AccessDenied'])

let cachedApiKey: { value: string | null; expiresAt: number } | null = null

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function plausibleApiKey(value: unknown) {
  const key = clean(value)
  return /^re_[A-Za-z0-9_-]{4,}$/.test(key) ? key : null
}

export function resendApiKeyFromSecretString(secretString: string | null) {
  const raw = clean(secretString)
  if (!raw) return null
  const direct = plausibleApiKey(raw)
  if (direct) return direct

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return plausibleApiKey(parsed.RESEND_API_KEY ?? parsed.api_key ?? parsed.apiKey)
  } catch {
    return null
  }
}

export function resendSecretId(environment: Environment = process.env) {
  const explicit = clean(environment.RESEND_SECRET_ID)
  if (explicit) return explicit
  return environment.NODE_ENV === 'production' ? DEFAULT_RESEND_SECRET_ID : null
}

async function loadSecretFromSecretsManager(secretId: string) {
  const { GetSecretValueCommand, SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager')
  const client = new SecretsManagerClient({})
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
  return response.SecretString ?? null
}

export async function loadResendApiKey(options: {
  environment?: Environment
  loadSecret?: SecretLoader
  now?: () => number
  useCache?: boolean
} = {}) {
  const environment = options.environment ?? process.env
  const fromEnvironment = plausibleApiKey(environment.RESEND_API_KEY)
  if (fromEnvironment) return fromEnvironment

  const secretId = resendSecretId(environment)
  if (!secretId) return null

  const now = options.now ?? Date.now
  const useCache = options.useCache ?? true
  if (useCache && cachedApiKey && cachedApiKey.expiresAt > now()) return cachedApiKey.value

  try {
    const value = resendApiKeyFromSecretString(await (options.loadSecret ?? loadSecretFromSecretsManager)(secretId))
    if (!value) console.error('resend_secret_incomplete')
    if (useCache) cachedApiKey = { value, expiresAt: now() + (value ? CACHE_TTL_MS : RETRY_TTL_MS) }
    return value
  } catch (error) {
    const name = error instanceof Error ? error.name : null
    console.error('resend_secret_unavailable', { name })
    const ttl = name && PERMANENT_SECRET_ERRORS.has(name) ? CACHE_TTL_MS : RETRY_TTL_MS
    if (useCache) cachedApiKey = { value: null, expiresAt: now() + ttl }
    return null
  }
}

export function resetResendApiKeyCache() {
  cachedApiKey = null
}

export class ResendApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message)
    this.name = 'ResendApiError'
  }

  get retryable() {
    return this.status === 0
      || this.status === 408
      || this.status === 429
      || this.status >= 500
      || this.code === 'concurrent_idempotent_requests'
  }
}

export type ResendEmailInput = {
  from: string
  to: string
  subject: string
  text: string
  html: string
  headers?: Array<{ Name: string; Value: string }>
  tags?: Array<{ name: string; value: string }>
  idempotencyKey?: string
}

export function createResendEmailClient(options: { apiKey: string; fetch?: FetchLike }) {
  const apiKey = plausibleApiKey(options.apiKey)
  if (!apiKey) throw new Error('resend_api_key_invalid')
  const send = options.fetch ?? ((input, init) => fetch(input, init))

  return {
    async sendEmail(input: ResendEmailInput) {
      const idempotencyKey = clean(input.idempotencyKey)
      if (idempotencyKey.length > 256) {
        throw new ResendApiError('invalid_idempotency_key', 400, 'Resend idempotency key is too long')
      }

      const customHeaders = Object.fromEntries(
        (input.headers ?? [])
          .filter((header) => clean(header.Name) && clean(header.Value))
          .map((header) => [header.Name, header.Value]),
      )
      const payload = {
        from: input.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        ...(Object.keys(customHeaders).length ? { headers: customHeaders } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
      }

      let response: Response
      try {
        response = await send(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey,
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: 'no-store',
        })
      } catch {
        throw new ResendApiError('network_error', 0, 'Resend request failed')
      }

      const text = await response.text()
      let body: Record<string, unknown> | null = null
      if (text) {
        try {
          body = JSON.parse(text) as Record<string, unknown>
        } catch {
          body = null
        }
      }

      if (!response.ok) {
        const code = clean(body?.name) || 'http_' + response.status
        const message = clean(body?.message) || 'Resend returned HTTP ' + response.status
        throw new ResendApiError(code, response.status, message.slice(0, 300))
      }

      const messageId = clean(body?.id)
      if (!messageId) throw new ResendApiError('invalid_response', 502, 'Resend returned no email id')
      return { messageId }
    },
  }
}

export type ResendEmailClient = ReturnType<typeof createResendEmailClient>
