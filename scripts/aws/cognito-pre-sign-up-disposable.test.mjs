// Round 14 (2.7): the Cognito pre-sign-up Lambda refuses self-service sign-ups (PreSignUp_SignUp)
// with a disposable email address, never AdminCreateUser (phone-only members) or Google, and its
// embedded domain list is identical to the app's src/lib/auth/disposable-email.ts.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { register } from 'node:module'
import test from 'node:test'

// The Lambda runtime provides the Cognito client; the stub keeps this test free of npm dependencies.
const stub = 'data:text/javascript,' + encodeURIComponent(
  'export class CognitoIdentityProviderClient { async send() { return { Users: [] } } } export class ListUsersCommand { constructor(input) { this.input = input } } export class AdminLinkProviderForUserCommand { constructor(input) { this.input = input } }',
)
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === '@aws-sdk/client-cognito-identity-provider') return { url: ${JSON.stringify(stub)}, shortCircuit: true }
  return next(specifier, context)
}`))

const lambda = await import('../../infra/aws/app/lambda/cognito-pre-sign-up-link.mjs')

function event(triggerSource, email, extra = {}) {
  return {
    triggerSource,
    userPoolId: 'ap-south-1_example',
    userName: '11111111-1111-4111-8111-111111111111',
    request: { userAttributes: { email } },
    response: {},
    ...extra,
  }
}

function domainsIn(source) {
  const block = /DISPOSABLE_EMAIL_DOMAINS[^=]*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/.exec(source)
  assert.ok(block, 'domain list not found')
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

test('refuses PreSignUp_SignUp with a disposable domain or subdomain, case-insensitively', async () => {
  const send = async () => { throw new Error('must not call Cognito') }
  const handler = lambda.createHandler({ client: { send } })
  for (const email of ['a@mailinator.com', 'A@MAILINATOR.COM', 'a@x.guerrillamail.com', 'a@10minutemail.com']) {
    await assert.rejects(handler(event('PreSignUp_SignUp', email)), /disposable_email_blocked: Please use a permanent email address\./)
  }
})

test('lets ordinary sign-ups, AdminCreateUser and Google through', async () => {
  const handler = lambda.createHandler({ client: { send: async () => ({ Users: [] }) } })
  const ordinary = event('PreSignUp_SignUp', 'captain@notmailinator.com')
  assert.equal(await handler(ordinary), ordinary)
  const admin = event('PreSignUp_AdminCreateUser', 'a@mailinator.com')
  assert.equal(await handler(admin), admin)
  const phone = event('PreSignUp_AdminCreateUser', 'phone-0123456789abcdef@auth.seaandshore.in')
  assert.equal(await handler(phone), phone)
  const google = event('PreSignUp_ExternalProvider', 'a@mailinator.com', {
    userName: 'Google_1234567890',
    request: { userAttributes: { email: 'a@mailinator.com', email_verified: 'true' } },
  })
  assert.equal(await handler(google), google)
})

test('the embedded list is identical to the app list', async () => {
  const app = await readFile(new URL('../../src/lib/auth/disposable-email.ts', import.meta.url), 'utf8')
  const source = await readFile(new URL('../../infra/aws/app/lambda/cognito-pre-sign-up-link.mjs', import.meta.url), 'utf8')
  const appDomains = domainsIn(app)
  assert.ok(appDomains.length >= 150)
  assert.deepEqual(domainsIn(source), appDomains)
  assert.deepEqual([...lambda.DISPOSABLE_EMAIL_DOMAINS], appDomains)
})
