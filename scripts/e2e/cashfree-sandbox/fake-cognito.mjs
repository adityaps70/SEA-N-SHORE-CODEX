// Cashfree sandbox checkout E2E: a stand-in for the Cognito user-pool API, so the app copy on the CI runner signs
// in one fixture member without touching the live user pool. The workflow points cognito-idp.<region>.amazonaws.com
// at 127.0.0.1 (/etc/hosts) and trusts this server's one-off certificate (NODE_EXTRA_CA_CERTS) for the app only.
// It answers only the calls a password sign-in, page loads and sign-out make; anything else is refused.
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'

const USER = {
  email: required('E2E_MEMBER_EMAIL').toLowerCase(),
  password: required('E2E_MEMBER_PASSWORD'),
  sub: required('E2E_MEMBER_SUB'),
  name: process.env.E2E_MEMBER_NAME ?? 'Sandbox Buyer',
}
const CLIENT_ID = required('AWS_COGNITO_CLIENT_ID')
const issued = new Map() // access token -> expiry (ms)
const refreshTokens = new Set()

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** An unsigned JWT-shaped token: the app only reads claims after GetUser vouched for it. */
export function accessToken(now = Date.now()) {
  const exp = Math.floor(now / 1000) + 3600
  const token = [
    base64url({ alg: 'none', typ: 'JWT' }),
    base64url({ sub: USER.sub, username: USER.sub, client_id: CLIENT_ID, token_use: 'access', scope: 'aws.cognito.signin.user.admin', iat: Math.floor(now / 1000), exp, jti: randomUUID(), origin_jti: randomUUID() }),
    'sandbox-e2e',
  ].join('.')
  issued.set(token, exp * 1000)
  return token
}

function tokens(withRefresh) {
  const result = { AccessToken: accessToken(), IdToken: accessToken(), ExpiresIn: 3600, TokenType: 'Bearer' }
  if (withRefresh) {
    const refresh = randomBytes(24).toString('base64url')
    refreshTokens.add(refresh)
    result.RefreshToken = refresh
  }
  return { AuthenticationResult: result, ChallengeParameters: {} }
}

const refuse = (type, message) => ({ status: 400, body: { __type: type, message } })

export function handle(operation, body) {
  switch (operation) {
    case 'InitiateAuth': {
      if (body.ClientId !== CLIENT_ID) return refuse('ResourceNotFoundException', 'Unknown client.')
      if (body.AuthFlow === 'USER_PASSWORD_AUTH') {
        const ok = String(body.AuthParameters?.USERNAME ?? '').toLowerCase() === USER.email && body.AuthParameters?.PASSWORD === USER.password
        return ok ? { status: 200, body: tokens(true) } : refuse('NotAuthorizedException', 'Incorrect username or password.')
      }
      if (body.AuthFlow === 'REFRESH_TOKEN_AUTH' || body.AuthFlow === 'REFRESH_TOKEN') {
        return refreshTokens.has(body.AuthParameters?.REFRESH_TOKEN) ? { status: 200, body: tokens(false) } : refuse('NotAuthorizedException', 'Invalid Refresh Token.')
      }
      return refuse('InvalidParameterException', 'Unsupported auth flow.')
    }
    case 'GetUser': {
      const expiry = issued.get(body.AccessToken)
      if (!expiry || expiry < Date.now()) return refuse('NotAuthorizedException', 'Invalid Access Token')
      return {
        status: 200,
        body: {
          Username: USER.sub,
          UserAttributes: [
            { Name: 'sub', Value: USER.sub },
            { Name: 'email', Value: USER.email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: USER.name },
          ],
          UserMFASettingList: [],
        },
      }
    }
    case 'GlobalSignOut':
      issued.clear()
      return { status: 200, body: {} }
    case 'RevokeToken':
      refreshTokens.delete(body.Token)
      return { status: 200, body: {} }
    default:
      return refuse('NotAuthorizedException', `The sandbox stand-in does not answer ${operation}.`)
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [certPath, keyPath, port = '443'] = process.argv.slice(2)
  createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, (request, response) => {
    let raw = ''
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      const operation = String(request.headers['x-amz-target'] ?? '').replace(/^AWSCognitoIdentityProviderService\./, '')
      let body = {}
      try { body = raw ? JSON.parse(raw) : {} } catch { /* refused below */ }
      const result = request.method === 'POST' ? handle(operation, body) : refuse('InvalidParameterException', 'POST only.')
      response.writeHead(result.status, { 'content-type': 'application/x-amz-json-1.1' })
      response.end(JSON.stringify(result.body))
      console.log(`FAKE_COGNITO ${operation || '-'} ${result.status}`)
    })
  }).listen(Number(port), '127.0.0.1', () => console.log(`FAKE_COGNITO_LISTENING port=${port}`))
}
