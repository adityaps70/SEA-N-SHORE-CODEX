// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import fixtures from './__fixtures__/encryption-sdk-messages.json'

// Fixtures were produced by the official AWS Encryption SDK (@aws-crypto/client-node) with a
// stand-in keyring that writes "aws-kms" encrypted data keys exactly like the KMS keyring, so
// the function is checked against real SDK output for every HKDF algorithm suite.
const KEY_ARN = fixtures.keyArn
const dataKeys = fixtures.dataKeys as Record<string, string>

async function load() {
  return import('../../../infra/aws/app/lambda/cognito-resend-email-sender.mjs')
}

function fakeKms(overrides: { keyId?: string } = {}) {
  return {
    decrypt: vi.fn(async (input: { CiphertextBlob: Uint8Array; KeyId: string }) => {
      const plaintext = dataKeys[Buffer.from(input.CiphertextBlob).toString('base64')]
      if (!plaintext) throw Object.assign(new Error('InvalidCiphertextException'), { name: 'InvalidCiphertextException' })
      return { KeyId: overrides.keyId ?? input.KeyId, Plaintext: Buffer.from(plaintext, 'base64') }
    }),
  }
}

function fixture(suite: string, label = 'code') {
  const found = fixtures.fixtures.find((item) => item.suite === suite && item.label === label)
  if (!found) throw new Error('missing fixture ' + suite + ' ' + label)
  return found
}

function tampered(message: string, mutate: (bytes: Buffer) => void) {
  const bytes = Buffer.from(message, 'base64')
  mutate(bytes)
  return bytes.toString('base64')
}

const SIGNED_V1 = 'ALG_AES256_GCM_IV12_TAG16_HKDF_SHA384_ECDSA_P384'
const COMMITTING = 'ALG_AES256_GCM_IV12_TAG16_HKDF_SHA512_COMMIT_KEY_ECDSA_P384'

describe('Cognito custom email sender: Encryption SDK decryption', () => {
  it.each(fixtures.fixtures.map((item) => [item.suite, item.label, item] as const))(
    'decrypts %s (%s) with only our KMS key',
    async (_suite, _label, item) => {
      const { decryptCognitoSecret } = await load()
      const kms = fakeKms()
      await expect(decryptCognitoSecret(item.message, { kms, keyArn: KEY_ARN })).resolves.toBe(item.plaintext)
      expect(kms.decrypt).toHaveBeenCalledTimes(1)
      const input = kms.decrypt.mock.calls[0]?.[0] as unknown as Record<string, unknown>
      expect(input.KeyId).toBe(KEY_ARN)
      expect(input.EncryptionContext).toMatchObject(fixtures.encryptionContext)
    },
  )

  it('refuses a message whose data key belongs to a different KMS key', async () => {
    const { decryptCognitoSecret } = await load()
    const kms = fakeKms()
    await expect(decryptCognitoSecret(fixture(SIGNED_V1).message, {
      kms,
      keyArn: 'arn:aws:kms:ap-south-1:111122223333:key/99999999-2222-4333-8444-555555555555',
    })).rejects.toMatchObject({ code: 'message_key_not_ours' })
    expect(kms.decrypt).not.toHaveBeenCalled()
  })

  it('refuses a data key that KMS unwrapped under another key id', async () => {
    const { decryptCognitoSecret } = await load()
    await expect(decryptCognitoSecret(fixture(SIGNED_V1).message, {
      kms: fakeKms({ keyId: 'arn:aws:kms:ap-south-1:111122223333:key/other' }),
      keyArn: KEY_ARN,
    })).rejects.toMatchObject({ code: 'data_key_unwrap_failed' })
  })

  it('rejects tampered ciphertext, signatures, commitments and framing', async () => {
    const { decryptCognitoSecret } = await load()
    const decrypt = (message: string) => decryptCognitoSecret(message, { kms: fakeKms(), keyArn: KEY_ARN })
    const unsigned = fixture('ALG_AES256_GCM_IV12_TAG16_HKDF_SHA256').message
    const signed = fixture(SIGNED_V1).message
    const committing = fixture(COMMITTING).message

    // Last byte of an unsigned message is the final frame's auth tag.
    await expect(decrypt(tampered(unsigned, (b) => { b[b.length - 1] ^= 1 }))).rejects.toMatchObject({ code: 'message_authentication_failed' })
    // Last byte of a signed message is inside the DER signature.
    await expect(decrypt(tampered(signed, (b) => { b[b.length - 3] ^= 1 }))).rejects.toMatchObject({ code: 'message_signature_invalid' })
    await expect(decrypt(Buffer.from(Buffer.from(unsigned, 'base64').subarray(0, 120)).toString('base64'))).rejects.toMatchObject({ code: 'message_truncated' })
    await expect(decrypt(Buffer.concat([Buffer.from(unsigned, 'base64'), Buffer.from([0])]).toString('base64'))).rejects.toMatchObject({ code: 'message_trailing_bytes' })
    await expect(decrypt(tampered(unsigned, (b) => { b[0] = 3 }))).rejects.toMatchObject({ code: 'message_version_unsupported' })
    await expect(decrypt('')).rejects.toMatchObject({ code: 'message_truncated' })

    const { parseEncryptedMessage } = await load()
    const parsed = parseEncryptedMessage(Buffer.from(committing, 'base64'))
    const commitmentOffset = parsed.header.length - 32
    await expect(decrypt(tampered(committing, (b) => { b[commitmentOffset] ^= 1 }))).rejects.toMatchObject({ code: 'message_commitment_mismatch' })
  })

  it('parses multi-frame messages in sequence, ending with a final frame', async () => {
    const { parseEncryptedMessage } = await load()
    const multi = parseEncryptedMessage(Buffer.from(fixture(SIGNED_V1, 'multi-frame').message, 'base64'))
    expect(multi.frames.map((frame: { sequence: number; final: boolean }) => [frame.sequence, frame.final]))
      .toEqual([[1, false], [2, false], [3, false], [4, true]])
    const exact = parseEncryptedMessage(Buffer.from(fixture(SIGNED_V1, 'exact-frames').message, 'base64'))
    expect(exact.frames.at(-1)).toMatchObject({ final: true, sequence: 3 })
    expect(exact.frames.at(-1)?.content.length).toBe(0)
  })
})

describe('Cognito custom email sender: Resend delivery', () => {
  const environment = {
    COGNITO_EMAIL_KMS_KEY_ARN: KEY_ARN,
    RESEND_SECRET_ID: 'sea-n-shore/resend',
    EMAIL_FROM: 'Sea N Shore <accounts@mail.seanshore.in>',
    SITE_URL: 'https://seanshore.in',
  }

  function event(triggerSource = 'CustomEmailSender_SignUp', item = fixture(SIGNED_V1)) {
    return {
      version: '1',
      triggerSource,
      region: 'ap-south-1',
      userPoolId: 'ap-south-1_example',
      userName: '11111111-1111-4111-8111-111111111111',
      request: {
        type: 'customEmailSenderRequestV1',
        code: item.message,
        userAttributes: { email: ' Member@Mariners.in ', email_verified: 'false' },
      },
    }
  }

  function setup(options: { secret?: string; status?: number; body?: unknown } = {}) {
    const secrets = { getSecretValue: vi.fn(async () => ({ SecretString: options.secret ?? JSON.stringify({ RESEND_API_KEY: 're_test_key_123' }) })) }
    const fetch = vi.fn(async () => new Response(JSON.stringify(options.body ?? { id: 'email_123' }), { status: options.status ?? 200 }))
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => { logs.push(String(line)) })
    return { secrets, fetch, logs, kms: fakeKms() }
  }

  it('sends the decrypted sign-up code from the verified Resend sender, once per encrypted code', async () => {
    const { createHandler } = await load()
    const deps = setup()
    const handler = createHandler({ environment, ...deps })
    await handler(event())

    expect(deps.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = deps.fetch.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer re_test_key_123')
    expect(init.headers['Idempotency-Key']).toMatch(/^cognito-[0-9a-f]{64}$/)
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      from: 'Sea N Shore <accounts@mail.seanshore.in>',
      to: ['member@mariners.in'],
      subject: 'Your Sea N Shore confirmation code',
    })
    expect(body.text).toContain('Your code: 482913')
    expect(body.html).toContain('482913')
    expect(body.tags).toEqual([{ name: 'category', value: 'account' }, { name: 'trigger', value: 'SignUp' }])

    // The same encrypted code always maps to the same idempotency key, so a Cognito retry
    // cannot send a second email.
    await handler(event())
    const second = deps.fetch.mock.calls[1] as unknown as [string, { headers: Record<string, string> }]
    expect(second[1].headers['Idempotency-Key']).toBe(init.headers['Idempotency-Key'])
    expect(deps.secrets.getSecretValue).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['CustomEmailSender_ResendCode', 'Your new Sea N Shore confirmation code'],
    ['CustomEmailSender_ForgotPassword', 'Reset your Sea N Shore password'],
    ['CustomEmailSender_UpdateUserAttribute', 'Confirm your new Sea N Shore email address'],
    ['CustomEmailSender_VerifyUserAttribute', 'Verify your Sea N Shore email address'],
    ['CustomEmailSender_Authentication', 'Your Sea N Shore sign-in code'],
    ['CustomEmailSender_AdminCreateUser', 'Your Sea N Shore account is ready'],
  ])('sends %s with its own subject', async (triggerSource, subject) => {
    const { createHandler } = await load()
    const deps = setup()
    await createHandler({ environment, ...deps })(event(triggerSource))
    const body = JSON.parse(String((deps.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.subject).toBe(subject)
    expect(body.text).toContain('482913')
  })

  it('never logs the code or the recipient address', async () => {
    const { createHandler } = await load()
    const deps = setup()
    await createHandler({ environment, ...deps })(event())
    const joined = deps.logs.join('\n')
    expect(joined).toContain('"outcome":"sent"')
    expect(joined).not.toContain('482913')
    expect(joined.toLowerCase()).not.toContain('member@mariners.in')
  })

  it('accepts a plain API key secret', async () => {
    const { createHandler } = await load()
    const deps = setup({ secret: 're_plain_key_456' })
    await createHandler({ environment, ...deps })(event())
    const init = (deps.fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1]
    expect(init.headers.Authorization).toBe('Bearer re_plain_key_456')
  })

  it('throws so Cognito retries when Resend refuses the email', async () => {
    const { createHandler } = await load()
    const deps = setup({ status: 429, body: { name: 'rate_limit_exceeded', message: 'Too many requests' } })
    await expect(createHandler({ environment, ...deps })(event())).rejects.toThrow('cognito_email_send_failed')
    expect(deps.logs.join('\n')).toContain('"status":429')
  })

  it('throws without calling Resend when the secret is unusable', async () => {
    const { createHandler } = await load()
    const deps = setup({ secret: '{"RESEND_API_KEY":"not-a-key"}' })
    await expect(createHandler({ environment, ...deps })(event())).rejects.toThrow('cognito_email_send_failed')
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('throws without calling Resend when the code cannot be decrypted', async () => {
    const { createHandler } = await load()
    const deps = setup()
    const bad = { ...fixture(SIGNED_V1), message: tampered(fixture(SIGNED_V1).message, (b) => { b[b.length - 3] ^= 1 }) }
    await expect(createHandler({ environment, ...deps })(event('CustomEmailSender_SignUp', bad))).rejects.toThrow('cognito_email_decrypt_failed')
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(deps.logs.join('\n')).toContain('message_signature_invalid')
  })

  it('throws when the KMS key setting or recipient is missing', async () => {
    const { createHandler } = await load()
    const deps = setup()
    await expect(createHandler({ environment: { ...environment, COGNITO_EMAIL_KMS_KEY_ARN: '' }, ...deps })(event()))
      .rejects.toThrow('cognito_email_kms_key_missing')
    const noEmail = event()
    noEmail.request.userAttributes.email = 'not an email'
    await expect(createHandler({ environment, ...deps })(noEmail)).rejects.toThrow('cognito_email_recipient_missing')
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  it('decrypts but never sends to reserved test domains such as the E2E @example.com users', async () => {
    const { createHandler, isReservedRecipient } = await load()
    const deps = setup()
    const reserved = event()
    reserved.request.userAttributes.email = 'sea-n-shore-e2e-1-seafarer@example.com'
    await expect(createHandler({ environment, ...deps })(reserved)).resolves.toBeUndefined()
    expect(deps.kms.decrypt).toHaveBeenCalledTimes(1)
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(deps.secrets.getSecretValue).not.toHaveBeenCalled()
    expect(deps.logs.join('\n')).toContain('"outcome":"reserved_recipient"')
    expect(deps.logs.join('\n')).not.toContain('example.com')

    // A bad code to a reserved address still fails, so the E2E evidence proves real decryption.
    const bad = event('CustomEmailSender_SignUp', { ...fixture(SIGNED_V1), message: tampered(fixture(SIGNED_V1).message, (b) => { b[b.length - 3] ^= 1 }) })
    bad.request.userAttributes.email = 'sea-n-shore-e2e-1-seafarer@example.com'
    await expect(createHandler({ environment, ...deps })(bad)).rejects.toThrow('cognito_email_decrypt_failed')

    for (const address of ['a@example.com', 'a@mail.example.org', 'a@example.net', 'a@host.test', 'a@x.invalid', 'a@localhost', 'a@site.example']) {
      expect(isReservedRecipient(address), address).toBe(true)
    }
    for (const address of ['a@gmail.com', 'a@seanshore.in', 'a@notexample.com', 'a@example.com.au']) {
      expect(isReservedRecipient(address), address).toBe(false)
    }
  })

  it('skips account-takeover notices without sending', async () => {
    const { createHandler } = await load()
    const deps = setup()
    await expect(createHandler({ environment, ...deps })(event('CustomEmailSender_AccountTakeOverNotification'))).resolves.toBeUndefined()
    expect(deps.fetch).not.toHaveBeenCalled()
    expect(deps.kms.decrypt).not.toHaveBeenCalled()
  })

  it('escapes the secret in the HTML body', async () => {
    const { accountEmail } = await load()
    const email = accountEmail('CustomEmailSender_AdminCreateUser', '<b>&"x\'', 'https://seanshore.in/')
    expect(email?.html).toContain('&lt;b&gt;&amp;&quot;x&#039;')
    expect(email?.html).not.toContain('<b>&"x')
    expect(email?.text).toContain('Sign in: https://seanshore.in/auth/sign-in')
    expect(accountEmail('CustomEmailSender_Unknown', '1')).toBeNull()
  })
})
