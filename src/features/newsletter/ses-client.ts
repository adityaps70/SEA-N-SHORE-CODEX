import { createAwsCredentialProvider, type AwsCredentialProvider } from './aws-credentials'
import { awsUriEncode, signAwsRequest } from './sigv4'

/**
 * Thin Amazon SES v2 API client (contact lists + SendEmail) over signed HTTPS.
 * API reference: https://docs.aws.amazon.com/ses/latest/APIReference-V2/
 */
export type SesTopicPreference = { TopicName: string; SubscriptionStatus: 'OPT_IN' | 'OPT_OUT' }

export type SesContact = {
  EmailAddress?: string
  TopicPreferences?: SesTopicPreference[]
  UnsubscribeAll?: boolean
}

export class SesApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message)
    this.name = 'SesApiError'
  }

  get retryable() {
    return this.status >= 500 || this.status === 429 || this.code === 'TooManyRequestsException' || this.code === 'network_error'
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

export type SesV2ClientOptions = {
  region: string
  credentials?: AwsCredentialProvider
  fetch?: Fetch
  now?: () => Date
}

function errorCodeFrom(response: Response, body: Record<string, unknown> | null) {
  const header = response.headers.get('x-amzn-errortype')?.split(':')[0]?.trim()
  const type = typeof body?.__type === 'string' ? body.__type.split('#').pop() : null
  return header || type || `http_${response.status}`
}

export function createSesV2Client(options: SesV2ClientOptions) {
  const credentials = options.credentials ?? createAwsCredentialProvider()
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const endpoint = `https://email.${options.region}.amazonaws.com`

  async function call<T>(method: string, path: string, payload?: unknown): Promise<T | null> {
    const body = payload === undefined ? '' : JSON.stringify(payload)
    const signed = signAwsRequest(
      {
        method,
        url: `${endpoint}${path}`,
        headers: payload === undefined ? {} : { 'content-type': 'application/json' },
        body,
      },
      { credentials: await credentials(), region: options.region, service: 'ses', now: options.now?.() },
    )

    let response: Response
    try {
      response = await send(`${endpoint}${path}`, {
        method,
        headers: signed.headers,
        body: payload === undefined ? undefined : body,
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      throw new SesApiError('network_error', 0, error instanceof Error ? error.message : 'SES request failed')
    }

    const text = await response.text()
    let json: Record<string, unknown> | null = null
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>
      } catch {
        json = null
      }
    }

    if (!response.ok) {
      const code = errorCodeFrom(response, json)
      const message = typeof json?.message === 'string' ? json.message : typeof json?.Message === 'string' ? json.Message : `SES returned ${response.status}`
      throw new SesApiError(code, response.status, message.slice(0, 300))
    }
    return json as T | null
  }

  const contactPath = (list: string, email?: string) =>
    `/v2/email/contact-lists/${awsUriEncode(list)}/contacts${email ? `/${awsUriEncode(email)}` : ''}`

  return {
    async getContact(list: string, email: string): Promise<SesContact | null> {
      try {
        return await call<SesContact>('GET', contactPath(list, email))
      } catch (error) {
        if (error instanceof SesApiError && error.code === 'NotFoundException') return null
        throw error
      }
    },

    /** Update the contact, creating it when it does not exist yet. */
    async upsertContact(list: string, contact: { email: string; topics: SesTopicPreference[]; unsubscribeAll: boolean }) {
      const update = { TopicPreferences: contact.topics, UnsubscribeAll: contact.unsubscribeAll }
      try {
        await call('PUT', contactPath(list, contact.email), update)
        return 'updated' as const
      } catch (error) {
        if (!(error instanceof SesApiError) || error.code !== 'NotFoundException') throw error
      }
      await call('POST', contactPath(list), { EmailAddress: contact.email, ...update })
      return 'created' as const
    },

    async deleteContact(list: string, email: string) {
      try {
        await call('DELETE', contactPath(list, email))
        return true
      } catch (error) {
        if (error instanceof SesApiError && error.code === 'NotFoundException') return false
        throw error
      }
    },

    async sendEmail(input: {
      from: string
      to: string
      subject: string
      text: string
      html: string
      headers?: Array<{ Name: string; Value: string }>
      listManagement?: { contactListName: string; topicName: string }
      configurationSetName?: string | null
      tags?: Array<{ Name: string; Value: string }>
    }) {
      const response = await call<{ MessageId?: string }>('POST', '/v2/email/outbound-emails', {
        FromEmailAddress: input.from,
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: input.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: input.text, Charset: 'UTF-8' },
              Html: { Data: input.html, Charset: 'UTF-8' },
            },
            ...(input.headers?.length ? { Headers: input.headers } : {}),
          },
        },
        ...(input.listManagement
          ? { ListManagementOptions: { ContactListName: input.listManagement.contactListName, TopicName: input.listManagement.topicName } }
          : {}),
        ...(input.configurationSetName ? { ConfigurationSetName: input.configurationSetName } : {}),
        ...(input.tags?.length ? { EmailTags: input.tags } : {}),
      })
      return { messageId: response?.MessageId ?? null }
    },
  }
}

export type SesV2Client = ReturnType<typeof createSesV2Client>
