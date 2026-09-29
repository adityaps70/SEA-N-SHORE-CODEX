import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const templateUrl = new URL('../../infra/aws/app/cloudfront/canonical-host-redirect.js.tftpl', import.meta.url)

const CANONICAL_HOST = 'seanshore.in'
const EDGE_HOST = 'd3prih0q6jofyr.cloudfront.net'

async function loadHandler({ redirectEdgeHost }) {
  const template = await readFile(templateUrl, 'utf8')
  const placeholders = template.match(/\$\{[^}]+\}/g) ?? []
  assert.deepEqual(
    [...new Set(placeholders)].sort(),
    ['${canonical_host}', '${edge_host}', '${redirect_edge_host}'],
    'the template must expose exactly the placeholders edge.tf renders',
  )
  const code = template
    .replaceAll('${canonical_host}', CANONICAL_HOST)
    .replaceAll('${edge_host}', EDGE_HOST)
    .replaceAll('${redirect_edge_host}', String(redirectEdgeHost))
  // CloudFront Functions expose a global `handler`; evaluate the rendered script the same way.
  return new Function(`${code}\nreturn handler;`)()
}

function event(host, uri, querystring = {}) {
  return {
    version: '1.0',
    context: { eventType: 'viewer-request' },
    viewer: { ip: '198.51.100.1' },
    request: {
      method: 'GET',
      uri,
      querystring,
      headers: host ? { host: { value: host } } : {},
      cookies: {},
    },
  }
}

test('www.seanshore.in is redirected to the apex with path and query kept', async () => {
  const handler = await loadHandler({ redirectEdgeHost: false })
  const result = handler(event('www.seanshore.in', '/jobs', { search: { value: 'Chief Engineer' }, page: { value: '2' } }))
  assert.equal(result.statusCode, 301)
  assert.equal(result.statusDescription, 'Moved Permanently')
  assert.equal(result.headers.location.value, 'https://seanshore.in/jobs?search=Chief%20Engineer&page=2')
  assert.equal(result.headers['cache-control'].value, 'public, max-age=3600')
})

test('www redirects apply to every path, including /api and the root', async () => {
  const handler = await loadHandler({ redirectEdgeHost: false })
  assert.equal(handler(event('www.seanshore.in', '/')).headers.location.value, 'https://seanshore.in/')
  assert.equal(handler(event('WWW.SEANSHORE.IN', '/api/health/phase4')).headers.location.value, 'https://seanshore.in/api/health/phase4')
  assert.equal(handler(event('www.seanshore.in:443', '/help')).headers.location.value, 'https://seanshore.in/help')
})

test('the canonical host and unknown hosts pass through untouched', async () => {
  const handler = await loadHandler({ redirectEdgeHost: false })
  for (const host of ['seanshore.in', 'SEANSHORE.IN', 'example.com', undefined]) {
    const incoming = event(host, '/profile', { tab: { value: 'passport' } })
    assert.equal(handler(incoming), incoming.request)
  }
})

test('the cloudfront.net host keeps working while the edge redirect is disabled', async () => {
  const handler = await loadHandler({ redirectEdgeHost: false })
  for (const uri of ['/', '/home', '/api/payments/cashfree/webhook', '/api/billing/cashfree/webhook']) {
    const incoming = event(EDGE_HOST, uri)
    assert.equal(handler(incoming), incoming.request)
  }
})

test('with the edge redirect enabled, cloudfront.net pages redirect but /api/* keeps answering', async () => {
  const handler = await loadHandler({ redirectEdgeHost: true })
  assert.equal(handler(event(EDGE_HOST, '/home', { q: { value: 'x' } })).headers.location.value, 'https://seanshore.in/home?q=x')
  assert.equal(handler(event(EDGE_HOST, '/')).headers.location.value, 'https://seanshore.in/')
  for (const uri of ['/api', '/api/', '/api/payments/cashfree/webhook', '/api/billing/cashfree/webhook', '/api/realtime/ticket']) {
    const incoming = event(EDGE_HOST, uri)
    assert.equal(handler(incoming), incoming.request, `${uri} must not be redirected`)
  }
  // Only the exact /api segment is exempt; look-alike paths redirect.
  assert.equal(handler(event(EDGE_HOST, '/apiary')).statusCode, 301)
  // www keeps redirecting in this mode too.
  assert.equal(handler(event('www.seanshore.in', '/api/x')).statusCode, 301)
})

test('query strings survive: repeated keys, empty values, encoded octets and plus signs', async () => {
  const handler = await loadHandler({ redirectEdgeHost: false })
  const result = handler(event('www.seanshore.in', '/search', {
    tag: { value: 'a', multiValue: [{ value: 'a' }, { value: 'b c' }] },
    empty: { value: '' },
    encoded: { value: 'x%20y' },
    plus: { value: 'a+b' },
    'odd key': { value: 'v=1&w=2' },
  }))
  assert.equal(
    result.headers.location.value,
    'https://seanshore.in/search?tag=a&tag=b%20c&empty=&encoded=x%20y&plus=a+b&odd%20key=v%3D1%26w%3D2',
  )
  assert.equal(handler(event('www.seanshore.in', '/x', {})).headers.location.value, 'https://seanshore.in/x')
})
