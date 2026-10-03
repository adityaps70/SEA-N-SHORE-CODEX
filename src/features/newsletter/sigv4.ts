import { createHash, createHmac } from 'node:crypto'

/**
 * Minimal AWS Signature Version 4 signer for JSON REST calls (used for the
 * Amazon SES v2 API, whose SDK client is not a dependency of this app).
 * Follows https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
 */
export type AwsCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string | null
}

export type SignableRequest = {
  method: string
  /** Full URL. Path segments must already be percent-encoded once (as sent on the wire). */
  url: string
  headers?: Record<string, string>
  body?: string
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

/** RFC 3986 encoding, as SigV4 requires. */
export function awsUriEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalPath(pathname: string) {
  // Non-S3 services: the (already encoded) path is encoded a second time.
  const path = pathname || '/'
  return path.split('/').map((segment) => awsUriEncode(segment)).join('/')
}

function canonicalQuery(searchParams: URLSearchParams) {
  return [...searchParams.entries()]
    .map(([key, value]) => [awsUriEncode(key), awsUriEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? (leftValue < rightValue ? -1 : 1) : leftKey < rightKey ? -1 : 1)
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

export function amzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

export function signAwsRequest(
  request: SignableRequest,
  input: { credentials: AwsCredentials; region: string; service: string; now?: Date },
) {
  const url = new URL(request.url)
  const timestamp = amzDate(input.now ?? new Date())
  const date = timestamp.slice(0, 8)
  const body = request.body ?? ''

  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers ?? {})) headers[name.toLowerCase()] = value
  headers.host = url.host
  headers['x-amz-date'] = timestamp
  if (input.credentials.sessionToken) headers['x-amz-security-token'] = input.credentials.sessionToken

  const signedHeaderNames = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name].trim().replace(/\s+/g, ' ')}\n`)
    .join('')
  const signedHeaders = signedHeaderNames.join(';')

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join('\n')

  const scope = `${date}/${input.region}/${input.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, date), input.region), input.service), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  delete headers.host
  return { headers, canonicalRequest, signature }
}
