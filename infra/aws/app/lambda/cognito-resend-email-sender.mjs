// Cognito custom email sender: Cognito hands every account email (sign-up codes, resend code,
// forgot password, email change, admin invites) to this function instead of its own
// 50-a-day default sender. The code arrives encrypted with the AWS Encryption SDK under our
// KMS key; we unwrap the data key with KMS, decrypt and verify the message here (no bundled
// dependencies), then send a branded email through Resend from the verified mail.seanshore.in
// sender. Codes, passwords and addresses are never logged.
import {
  createDecipheriv,
  createHash,
  createPublicKey,
  ECDH,
  hkdfSync,
  timingSafeEqual,
  verify,
} from 'node:crypto'

// The Lambda Node.js runtime ships AWS SDK v3; it is loaded lazily so tests can inject fakes
// without adding the KMS client to the web app's dependencies.
const KMS_MODULE = '@aws-sdk/client-kms'
const SECRETS_MODULE = '@aws-sdk/client-secrets-manager'

async function defaultKms() {
  const { DecryptCommand, KMSClient } = await import(KMS_MODULE)
  const client = new KMSClient({})
  return { decrypt: (input) => client.send(new DecryptCommand(input)) }
}

async function defaultSecrets() {
  const { GetSecretValueCommand, SecretsManagerClient } = await import(SECRETS_MODULE)
  const client = new SecretsManagerClient({})
  return { getSecretValue: (input) => client.send(new GetSecretValueCommand(input)) }
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const REQUEST_TIMEOUT_MS = 8_000
const KEY_CACHE_TTL_MS = 5 * 60_000
const DEFAULT_RESEND_SECRET_ID = 'sea-n-shore/resend'
const DEFAULT_FROM = 'Sea N Shore <accounts@mail.seanshore.in>'
const DEFAULT_SITE_URL = 'https://seanshore.in'
const MAX_ENCRYPTED_DATA_KEYS = 10
const PUBLIC_KEY_CONTEXT = 'aws-crypto-public-key'

// AWS Encryption SDK algorithm suites that use HKDF (the SDK never emits the legacy no-KDF
// suites by default, so they are refused rather than silently supported).
const SUITES = {
  0x0114: { version: 1, keyBytes: 16, hash: 'sha256' },
  0x0146: { version: 1, keyBytes: 24, hash: 'sha256' },
  0x0178: { version: 1, keyBytes: 32, hash: 'sha256' },
  0x0214: { version: 1, keyBytes: 16, hash: 'sha256', curve: 'prime256v1', jwkCurve: 'P-256', signatureHash: 'sha256' },
  0x0346: { version: 1, keyBytes: 24, hash: 'sha384', curve: 'secp384r1', jwkCurve: 'P-384', signatureHash: 'sha384' },
  0x0378: { version: 1, keyBytes: 32, hash: 'sha384', curve: 'secp384r1', jwkCurve: 'P-384', signatureHash: 'sha384' },
  0x0478: { version: 2, keyBytes: 32, hash: 'sha512', committing: true },
  0x0578: { version: 2, keyBytes: 32, hash: 'sha512', committing: true, curve: 'secp384r1', jwkCurve: 'P-384', signatureHash: 'sha384' },
}

export class EncryptedMessageError extends Error {
  constructor(code) {
    super(code)
    this.name = 'EncryptedMessageError'
    this.code = code
  }
}

function fail(code) {
  throw new EncryptedMessageError(code)
}

class Reader {
  constructor(buffer) {
    this.buffer = buffer
    this.offset = 0
  }

  take(length) {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.buffer.length) fail('message_truncated')
    const value = this.buffer.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  u8() { return this.take(1).readUInt8(0) }
  u16() { return this.take(2).readUInt16BE(0) }
  u32() { return this.take(4).readUInt32BE(0) }
}

function u16(value) {
  const out = Buffer.alloc(2)
  out.writeUInt16BE(value)
  return out
}

function u32(value) {
  const out = Buffer.alloc(4)
  out.writeUInt32BE(value)
  return out
}

function u64(value) {
  const out = Buffer.alloc(8)
  out.writeBigUInt64BE(BigInt(value))
  return out
}

function readEncryptionContext(reader) {
  const length = reader.u16()
  const context = {}
  if (length === 0) return context
  const section = new Reader(reader.take(length))
  const count = section.u16()
  if (count === 0) fail('message_context_invalid')
  for (let index = 0; index < count; index += 1) {
    const key = section.take(section.u16()).toString('utf8')
    const value = section.take(section.u16()).toString('utf8')
    if (Object.hasOwn(context, key)) fail('message_context_invalid')
    context[key] = value
  }
  if (section.offset !== section.buffer.length) fail('message_context_invalid')
  return context
}

/** Parses an AWS Encryption SDK framed message (format versions 1 and 2). */
export function parseEncryptedMessage(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const reader = new Reader(buffer)
  const version = reader.u8()
  if (version !== 1 && version !== 2) fail('message_version_unsupported')
  if (version === 1 && reader.u8() !== 0x80) fail('message_type_unsupported')
  const suiteId = reader.u16()
  const suite = SUITES[suiteId]
  if (!suite || suite.version !== version) fail('message_suite_unsupported')
  const messageId = reader.take(version === 1 ? 16 : 32)
  const encryptionContext = readEncryptionContext(reader)

  const edkCount = reader.u16()
  if (edkCount === 0 || edkCount > MAX_ENCRYPTED_DATA_KEYS) fail('message_keys_invalid')
  const encryptedDataKeys = []
  for (let index = 0; index < edkCount; index += 1) {
    encryptedDataKeys.push({
      providerId: reader.take(reader.u16()).toString('utf8'),
      providerInfo: reader.take(reader.u16()).toString('utf8'),
      ciphertext: Buffer.from(reader.take(reader.u16())),
    })
  }

  if (reader.u8() !== 0x02) fail('message_not_framed')
  let ivLength = 12
  if (version === 1) {
    if (reader.u32() !== 0) fail('message_reserved_invalid')
    ivLength = reader.u8()
    if (ivLength !== 12) fail('message_iv_invalid')
  }
  const frameLength = reader.u32()
  if (frameLength === 0) fail('message_frame_invalid')
  const commitment = suite.committing ? Buffer.from(reader.take(32)) : null
  const header = buffer.subarray(0, reader.offset)
  const headerIv = version === 1 ? Buffer.from(reader.take(ivLength)) : Buffer.alloc(12)
  const headerTag = Buffer.from(reader.take(16))

  const frames = []
  for (let expected = 1; ; expected += 1) {
    const marker = reader.u32()
    const final = marker === 0xffffffff
    const sequence = final ? reader.u32() : marker
    if (sequence !== expected) fail('message_sequence_invalid')
    const iv = Buffer.from(reader.take(ivLength))
    const length = final ? reader.u32() : frameLength
    if (length > frameLength) fail('message_frame_invalid')
    frames.push({ final, sequence, iv, content: Buffer.from(reader.take(length)), tag: Buffer.from(reader.take(16)) })
    if (final) break
  }
  const signedBytes = buffer.subarray(0, reader.offset)

  let signature = null
  if (suite.curve) signature = Buffer.from(reader.take(reader.u16()))
  if (reader.offset !== buffer.length) fail('message_trailing_bytes')

  const hasPublicKey = Object.hasOwn(encryptionContext, PUBLIC_KEY_CONTEXT)
  if (Boolean(suite.curve) !== hasPublicKey) fail('message_signature_context_invalid')

  return {
    version,
    suiteId,
    suite,
    messageId: Buffer.from(messageId),
    encryptionContext,
    encryptedDataKeys,
    header: Buffer.from(header),
    headerIv,
    headerTag,
    commitment,
    frames,
    signedBytes: Buffer.from(signedBytes),
    signature,
  }
}

function deriveKey(message, dataKey) {
  const { suite, suiteId, messageId } = message
  if (dataKey.length !== suite.keyBytes) fail('data_key_invalid')
  if (!suite.committing) {
    return Buffer.from(hkdfSync(suite.hash, dataKey, Buffer.alloc(0), Buffer.concat([u16(suiteId), messageId]), suite.keyBytes))
  }
  const commitment = Buffer.from(hkdfSync(suite.hash, dataKey, messageId, Buffer.from('COMMITKEY'), 32))
  if (!timingSafeEqual(commitment, message.commitment)) fail('message_commitment_mismatch')
  return Buffer.from(hkdfSync(suite.hash, dataKey, messageId, Buffer.concat([u16(suiteId), Buffer.from('DERIVEKEY')]), suite.keyBytes))
}

function gcmDecrypt(keyBytes, key, iv, aad, content, tag) {
  try {
    const decipher = createDecipheriv(`aes-${keyBytes * 8}-gcm`, key, iv)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(content), decipher.final()])
  } catch {
    fail('message_authentication_failed')
  }
}

function verifySignature(message) {
  const { suite } = message
  try {
    const compressed = Buffer.from(message.encryptionContext[PUBLIC_KEY_CONTEXT], 'base64')
    const point = ECDH.convertKey(compressed, suite.curve, undefined, undefined, 'uncompressed')
    const size = (point.length - 1) / 2
    const key = createPublicKey({
      format: 'jwk',
      key: {
        kty: 'EC',
        crv: suite.jwkCurve,
        x: point.subarray(1, 1 + size).toString('base64url'),
        y: point.subarray(1 + size).toString('base64url'),
      },
    })
    if (verify(suite.signatureHash, message.signedBytes, { key, dsaEncoding: 'der' }, message.signature)) return
  } catch {
    // fall through to the uniform failure below
  }
  fail('message_signature_invalid')
}

/** Decrypts a parsed message once its data key has been unwrapped. */
export function decryptWithDataKey(message, dataKeyInput) {
  const dataKey = Buffer.from(dataKeyInput)
  const key = deriveKey(message, dataKey)
  const { keyBytes } = message.suite
  gcmDecrypt(keyBytes, key, message.headerIv, message.header, Buffer.alloc(0), message.headerTag)
  const parts = message.frames.map((frame) => {
    const label = frame.final ? 'AWSKMSEncryptionClient Final Frame' : 'AWSKMSEncryptionClient Frame'
    const aad = Buffer.concat([message.messageId, Buffer.from(label), u32(frame.sequence), u64(frame.content.length)])
    return gcmDecrypt(keyBytes, key, frame.iv, aad, frame.content, frame.tag)
  })
  if (message.suite.curve) verifySignature(message)
  return Buffer.concat(parts)
}

/** Unwraps the data key with our KMS key only, then decrypts the Cognito secret. */
export async function decryptCognitoSecret(encoded, input) {
  const message = parseEncryptedMessage(Buffer.from(String(encoded ?? ''), 'base64'))
  const candidates = message.encryptedDataKeys.filter((edk) => edk.providerId === 'aws-kms' && edk.providerInfo === input.keyArn)
  if (!candidates.length) fail('message_key_not_ours')
  for (const edk of candidates) {
    let response
    try {
      response = await input.kms.decrypt({
        CiphertextBlob: edk.ciphertext,
        EncryptionContext: message.encryptionContext,
        KeyId: input.keyArn,
      })
    } catch {
      continue
    }
    if (response?.KeyId !== input.keyArn || !response?.Plaintext) continue
    return decryptWithDataKey(message, response.Plaintext).toString('utf8')
  }
  fail('data_key_unwrap_failed')
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function plausibleApiKey(value) {
  const key = clean(value)
  return /^re_[A-Za-z0-9_-]{4,}$/.test(key) ? key : null
}

export function resendApiKeyFromSecretString(secretString) {
  const raw = clean(secretString)
  if (!raw) return null
  const direct = plausibleApiKey(raw)
  if (direct) return direct
  try {
    const parsed = JSON.parse(raw)
    return plausibleApiKey(parsed?.RESEND_API_KEY ?? parsed?.api_key ?? parsed?.apiKey)
  } catch {
    return null
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] ?? character)
}

const TEMPLATES = {
  CustomEmailSender_SignUp: {
    subject: 'Your Sea N Shore confirmation code',
    heading: 'Confirm your email address',
    intro: 'Use this code to confirm your email address and finish creating your Sea N Shore account.',
    validity: 'The code expires in 24 hours.',
  },
  CustomEmailSender_ResendCode: {
    subject: 'Your new Sea N Shore confirmation code',
    heading: 'Here is your new confirmation code',
    intro: 'Use this code to confirm your email address and finish creating your Sea N Shore account.',
    validity: 'The code expires in 24 hours. Earlier codes no longer work.',
  },
  CustomEmailSender_ForgotPassword: {
    subject: 'Reset your Sea N Shore password',
    heading: 'Reset your password',
    intro: 'Use this code to choose a new password for your Sea N Shore account.',
    validity: 'The code expires in 1 hour.',
  },
  CustomEmailSender_UpdateUserAttribute: {
    subject: 'Confirm your new Sea N Shore email address',
    heading: 'Confirm your new email address',
    intro: 'Use this code to confirm this email address for your Sea N Shore account.',
    validity: 'The code expires in 24 hours. Your previous address stays active until you confirm.',
  },
  CustomEmailSender_VerifyUserAttribute: {
    subject: 'Verify your Sea N Shore email address',
    heading: 'Verify your email address',
    intro: 'Use this code to verify the email address on your Sea N Shore account.',
    validity: 'The code expires in 24 hours.',
  },
  CustomEmailSender_Authentication: {
    subject: 'Your Sea N Shore sign-in code',
    heading: 'Your sign-in code',
    intro: 'Use this code to finish signing in to Sea N Shore.',
    validity: 'The code expires in a few minutes.',
  },
  CustomEmailSender_AdminCreateUser: {
    subject: 'Your Sea N Shore account is ready',
    heading: 'Your Sea N Shore account is ready',
    intro: 'An account has been created for you. Sign in with this email address and the temporary password below, then choose your own password.',
    validity: 'The temporary password expires in 7 days.',
    secretLabel: 'Temporary password',
  },
}

export const SUPPORTED_TRIGGER_SOURCES = Object.freeze(Object.keys(TEMPLATES))

export function accountEmail(triggerSource, secret, siteUrl = DEFAULT_SITE_URL) {
  const template = TEMPLATES[triggerSource]
  if (!template) return null
  const site = clean(siteUrl).replace(/\/+$/g, '') || DEFAULT_SITE_URL
  const label = template.secretLabel ?? 'Your code'
  const signIn = `${site}/auth/sign-in`
  const footer = 'If you did not ask for this, you can ignore this email. Never share this code with anyone, including Sea N Shore staff.'
  const text = [
    template.heading,
    '',
    template.intro,
    '',
    `${label}: ${secret}`,
    '',
    template.validity,
    '',
    triggerSource === 'CustomEmailSender_AdminCreateUser' ? `Sign in: ${signIn}` : null,
    triggerSource === 'CustomEmailSender_AdminCreateUser' ? '' : null,
    footer,
    '',
    'Sea N Shore',
  ].filter((line) => line !== null).join('\n')

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f5f8fa;font-family:Arial,sans-serif;color:#123047">
    <div style="max-width:640px;margin:0 auto;padding:32px 18px">
      <div style="background:#fff;border:1px solid #dce8ef;border-radius:18px;padding:32px">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.12em;color:#16789d">SEA N SHORE</p>
        <h1 style="margin:0 0 18px;font-size:28px;line-height:1.15;color:#0d3047">${escapeHtml(template.heading)}</h1>
        <p style="font-size:16px;line-height:1.65">${escapeHtml(template.intro)}</p>
        <p style="margin:24px 0 6px;font-size:13px;font-weight:700;color:#667987">${escapeHtml(label)}</p>
        <p style="margin:0 0 24px;font-size:30px;font-weight:700;letter-spacing:.18em;color:#0d3047;font-family:'Courier New',monospace">${escapeHtml(secret)}</p>
        <p style="font-size:15px;line-height:1.65">${escapeHtml(template.validity)}</p>${triggerSource === 'CustomEmailSender_AdminCreateUser' ? `
        <p style="margin:26px 0"><a href="${escapeHtml(signIn)}" style="display:inline-block;background:#08789e;color:#fff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:10px">Sign in to Sea N Shore</a></p>` : ''}
        <p style="margin-top:28px;font-size:12px;line-height:1.6;color:#667987">${escapeHtml(footer)}</p>
      </div>
    </div>
  </body>
</html>`

  return { subject: template.subject, text, html }
}

function recipient(event) {
  const email = clean(event?.request?.userAttributes?.email).toLowerCase()
  return /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/.test(email) ? email : null
}

function log(fields) {
  console.log(JSON.stringify({ service: 'cognito-resend-email-sender', ...fields }))
}

export function createHandler(input = {}) {
  const environment = input.environment ?? process.env
  let kmsClient = input.kms ? Promise.resolve(input.kms) : null
  let secretsClient = input.secrets ? Promise.resolve(input.secrets) : null
  const kms = () => (kmsClient ??= defaultKms())
  const secrets = () => (secretsClient ??= defaultSecrets())
  const send = input.fetch ?? ((url, init) => fetch(url, init))
  const now = input.now ?? Date.now
  let cachedKey = null

  async function apiKey() {
    if (cachedKey && cachedKey.expiresAt > now()) return cachedKey.value
    const response = await (await secrets()).getSecretValue({
      SecretId: clean(environment.RESEND_SECRET_ID) || DEFAULT_RESEND_SECRET_ID,
    })
    const value = resendApiKeyFromSecretString(response?.SecretString ?? null)
    if (!value) throw new Error('resend_secret_incomplete')
    cachedKey = { value, expiresAt: now() + KEY_CACHE_TTL_MS }
    return value
  }

  return async function handler(event) {
    const triggerSource = clean(event?.triggerSource)
    if (!TEMPLATES[triggerSource]) {
      // Account-takeover notices need Cognito advanced security, which this pool does not use.
      log({ outcome: 'skipped', triggerSource })
      return
    }

    const keyArn = clean(environment.COGNITO_EMAIL_KMS_KEY_ARN)
    if (!keyArn) throw new Error('cognito_email_kms_key_missing')
    const to = recipient(event)
    if (!to) {
      log({ outcome: 'no_recipient', triggerSource })
      throw new Error('cognito_email_recipient_missing')
    }

    let secret
    try {
      secret = await decryptCognitoSecret(event?.request?.code, { kms: await kms(), keyArn })
    } catch (error) {
      log({ outcome: 'decrypt_failed', triggerSource, error: error instanceof EncryptedMessageError ? error.code : 'unexpected' })
      throw new Error('cognito_email_decrypt_failed')
    }
    if (!secret) throw new Error('cognito_email_secret_empty')

    const email = accountEmail(triggerSource, secret, environment.SITE_URL)
    // Cognito retries a failed invocation; the same encrypted code must not send twice.
    const idempotencyKey = 'cognito-' + createHash('sha256')
      .update([triggerSource, clean(event?.userPoolId), clean(event?.userName), clean(event?.request?.code)].join('\n'))
      .digest('hex')

    let key
    try {
      key = await apiKey()
    } catch {
      log({ outcome: 'send_failed', triggerSource, status: 0, reason: 'secret' })
      throw new Error('cognito_email_send_failed')
    }

    let response
    try {
      response = await send(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: clean(environment.EMAIL_FROM) || DEFAULT_FROM,
          to: [to],
          subject: email.subject,
          text: email.text,
          html: email.html,
          tags: [{ name: 'category', value: 'account' }, { name: 'trigger', value: triggerSource.replace(/^CustomEmailSender_/, '') }],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      log({ outcome: 'send_failed', triggerSource, status: 0, reason: 'network' })
      throw new Error('cognito_email_send_failed')
    }

    const body = await response.json().catch(() => null)
    if (!response.ok || !clean(body?.id)) {
      log({ outcome: 'send_failed', triggerSource, status: response.status, name: clean(body?.name) || null })
      throw new Error('cognito_email_send_failed')
    }
    log({ outcome: 'sent', triggerSource, resendId: clean(body.id) })
  }
}

export const handler = createHandler()
