export const DEFAULT_RESEND_SECRET_ID = 'sea-n-shore/resend'
export const DEFAULT_RESEND_ADMIN_SECRET_ID = 'sea-n-shore/resend-admin'

type Environment = Record<string, string | undefined>
type SecretLoader = (secretId: string) => Promise<string | null>
type FetchLike = (input: string, init: RequestInit) => Promise<Response>

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 5 * 60_000
const RETRY_TTL_MS = 30_000
const PERMANENT_SECRET_ERRORS = new Set(['ResourceNotFoundException', 'AccessDeniedException', 'AccessDenied'])

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

type KeyCache = { value: string | null; expiresAt: number } | null

async function loadKey(
  cache: { current: KeyCache },
  fromEnvironment: string | undefined,
  secretId: string | null,
  options: { loadSecret?: SecretLoader; now?: () => number; useCache?: boolean },
  label: string,
) {
  const direct = plausibleApiKey(fromEnvironment)
  if (direct) return direct
  if (!secretId) return null

  const now = options.now ?? Date.now
  const useCache = options.useCache ?? true
  if (useCache && cache.current && cache.current.expiresAt > now()) return cache.current.value

  try {
    const value = resendApiKeyFromSecretString(await (options.loadSecret ?? loadSecretFromSecretsManager)(secretId))
    if (!value) console.error(`${label}_incomplete`)
    if (useCache) cache.current = { value, expiresAt: now() + (value ? CACHE_TTL_MS : RETRY_TTL_MS) }
    return value
  } catch (error) {
    const name = error instanceof Error ? error.name : null
    console.error(`${label}_unavailable`, { name })
    const ttl = name && PERMANENT_SECRET_ERRORS.has(name) ? CACHE_TTL_MS : RETRY_TTL_MS
    if (useCache) cache.current = { value: null, expiresAt: now() + ttl }
    return null
  }
}

const sendingKeyCache: { current: KeyCache } = { current: null }
const adminKeyCache: { current: KeyCache } = { current: null }

/** The production sending key ("Sending access" only). Every email is sent with this key. */
export async function loadResendApiKey(options: {
  environment?: Environment
  loadSecret?: SecretLoader
  now?: () => number
  useCache?: boolean
} = {}) {
  const environment = options.environment ?? process.env
  return loadKey(sendingKeyCache, environment.RESEND_API_KEY, resendSecretId(environment), options, 'resend_secret')
}

export function resendAdminSecretId(environment: Environment = process.env) {
  const explicit = clean(environment.RESEND_ADMIN_SECRET_ID)
  if (explicit) return explicit
  return environment.NODE_ENV === 'production' ? DEFAULT_RESEND_ADMIN_SECRET_ID : null
}

/**
 * The full-access key ("sea-n-shore/resend-admin", the key in plaintext). Used ONLY to read delivery status and
 * the suppression list (the outbox worker's backfill and sync) and by the webhook runner on the bootstrap host.
 * Never used to send.
 */
export async function loadResendAdminApiKey(options: {
  environment?: Environment
  loadSecret?: SecretLoader
  now?: () => number
  useCache?: boolean
} = {}) {
  const environment = options.environment ?? process.env
  return loadKey(adminKeyCache, environment.RESEND_ADMIN_API_KEY, resendAdminSecretId(environment), options, 'resend_admin_secret')
}

export function resetResendApiKeyCache() {
  sendingKeyCache.current = null
  adminKeyCache.current = null
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
  /** Files attached to the email; `content` is base64. */
  attachments?: Array<{ filename: string; content: string }>
  /** Where a reply goes (Resend `reply_to`), when it should not go to the sender address. */
  replyTo?: string
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
      const attachments = (input.attachments ?? [])
        .filter((attachment) => clean(attachment.filename) && clean(attachment.content))
        .map((attachment) => ({ filename: clean(attachment.filename), content: clean(attachment.content) }))
      const payload = {
        from: input.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        ...(Object.keys(customHeaders).length ? { headers: customHeaders } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(clean(input.replyTo) ? { reply_to: clean(input.replyTo) } : {}),
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

    /** One sent email's current status. `lastEvent` is Resend's `last_event`, e.g. "delivered" or "bounced". */
    async getEmail(id: string): Promise<ResendEmailStatus> {
      if (!/^[A-Za-z0-9-]{1,100}$/.test(id)) throw new ResendApiError('invalid_email_id', 400, 'Resend email id is malformed')
      const body = await getJson(`https://api.resend.com/emails/${id}`)
      const to = Array.isArray(body.to) ? body.to.map(clean).filter(Boolean) : []
      return { id: clean(body.id) || id, lastEvent: clean(body.last_event) || null, to, createdAt: clean(body.created_at) || null }
    },

    /** One page of the team's suppression list, newest first. Pass the last id of a page as `after` for the next. */
    async listSuppressions(input: { after?: string; limit?: number } = {}): Promise<{ data: ResendSuppression[]; hasMore: boolean }> {
      const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(100, Math.floor(input.limit ?? 100)))) })
      if (input.after) params.set('after', input.after)
      const body = await getJson(`https://api.resend.com/suppressions?${params}`)
      const data = Array.isArray(body.data) ? body.data : []
      return {
        data: data
          .map((row: Record<string, unknown>) => ({
            id: clean(row?.id),
            email: clean(row?.email).toLowerCase(),
            origin: clean(row?.origin) || null,
            sourceId: clean(row?.source_id) || null,
          }))
          .filter((row: ResendSuppression) => row.id && row.email),
        hasMore: body.has_more === true,
      }
    },
  }

  async function getJson(url: string): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await send(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch {
      throw new ResendApiError('network_error', 0, 'Resend request failed')
    }
    const text = await response.text()
    let body: Record<string, unknown> | null = null
    try {
      body = text ? JSON.parse(text) as Record<string, unknown> : null
    } catch {
      body = null
    }
    if (!response.ok) {
      const code = clean(body?.name) || 'http_' + response.status
      const message = clean(body?.message) || 'Resend returned HTTP ' + response.status
      throw new ResendApiError(code, response.status, message.slice(0, 300))
    }
    if (!body) throw new ResendApiError('invalid_response', 502, 'Resend returned no JSON body')
    return body
  }
}

export type ResendEmailStatus = { id: string; lastEvent: string | null; to: string[]; createdAt: string | null }
export type ResendSuppression = { id: string; email: string; origin: string | null; sourceId: string | null }

export type ResendEmailClient = ReturnType<typeof createResendEmailClient>
