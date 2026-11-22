import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const templateUrl = new URL('../../infra/aws/app/cloudfront/canonical-host-redirect.js.tftpl', import.meta.url)

const CANONICAL_HOST = 'seanshore.in'
const EDGE_HOST = 'd3prih0q6jofyr.cloudfront.net'
const ALIAS_HOSTS = ['seanshore.net']

async function loadHandler({ redirectEdgeHost }) {
  const template = await readFile(templateUrl, 'utf8')
  const placeholders = template.match(/\$\{[^}]+\}/g) ?? []
  assert.deepEqual(
    [...new Set(placeholders)].sort(),
    ['${alias_hosts}', '${canonical_host}', '${edge_host}', '${redirect_edge_host}'],
    'the template must expose exactly the placeholders edge.tf renders',
  )
  const code = template
    .replaceAll('${canonical_host}', CANONICAL_HOST)
    // edge.tf renders jsonencode(local.site_alias_hosts).
    .replaceAll('${alias_hosts}', JSON.stringify(ALIAS_HOSTS))
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

// Domain move (21 Nov live check after #562): the app picks the origin to send a visitor back to from
// x-sns-viewer-host (src/lib/site-url.ts), so the edge must never pass on what a browser sent in it.
test('x-sns-viewer-host is always the Host CloudFront answered on, never what the client sent', async () => {
  for (const redirectEdgeHost of [false, true]) {
    const handler = await loadHandler({ redirectEdgeHost })
    const faked = event('seanshore.in', '/auth/session-ended')
    faked.request.headers['x-sns-viewer-host'] = { value: 'seanshore.net' }
    assert.deepEqual(handler(faked).headers['x-sns-viewer-host'], { value: 'seanshore.in' })
    const plain = event('SEANSHORE.IN:443', '/home')
    assert.deepEqual(handler(plain).headers['x-sns-viewer-host'], { value: 'seanshore.in' })
    const api = event(EDGE_HOST, '/api/payments/cashfree/webhook')
    api.request.headers['x-sns-viewer-host'] = { value: 'seanshore.net' }
    assert.deepEqual(handler(api).headers['x-sns-viewer-host'], { value: EDGE_HOST })
    // No Host at all: the header is removed, never kept from the client.
    const hostless = event(undefined, '/home')
    hostless.request.headers['x-sns-viewer-host'] = { value: 'seanshore.net' }
    assert.equal(handler(hostless).headers['x-sns-viewer-host'], undefined)
    assert.ok(!('x-sns-viewer-host' in hostless.request.headers))
    // Redirects are unchanged and carry no such header.
    const www = event('www.seanshore.in', '/jobs')
    www.request.headers['x-sns-viewer-host'] = { value: 'seanshore.net' }
    const redirected = handler(www)
    assert.equal(redirected.statusCode, 301)
    assert.equal(redirected.headers.location.value, 'https://seanshore.in/jobs')
    assert.equal(redirected.headers['x-sns-viewer-host'], undefined)
  }
})

// Domain move, Phase 1 serve step: seanshore.net is served by the same distribution; www.seanshore.net goes to its
// own apex (not to seanshore.in), and the apex passes through with x-sns-viewer-host: seanshore.net.
test('www.seanshore.net is redirected to https://seanshore.net with path and query kept, for every path', async () => {
  for (const redirectEdgeHost of [false, true]) {
    const handler = await loadHandler({ redirectEdgeHost })
    const result = handler(event('www.seanshore.net', '/jobs', { search: { value: 'Chief Engineer' } }))
    assert.equal(result.statusCode, 301)
    assert.equal(result.headers.location.value, 'https://seanshore.net/jobs?search=Chief%20Engineer')
    assert.equal(result.headers['cache-control'].value, 'public, max-age=3600')
    assert.equal(handler(event('WWW.SEANSHORE.NET:443', '/')).headers.location.value, 'https://seanshore.net/')
    assert.equal(handler(event('www.seanshore.net', '/api/health/live')).headers.location.value, 'https://seanshore.net/api/health/live')
    // www.seanshore.in still goes to seanshore.in.
    assert.equal(handler(event('www.seanshore.in', '/x')).headers.location.value, 'https://seanshore.in/x')
  }
})

test('seanshore.net passes through and is named in x-sns-viewer-host, whatever the client sent', async () => {
  const handler = await loadHandler({ redirectEdgeHost: true })
  const incoming = event('seanshore.net', '/home')
  incoming.request.headers['x-sns-viewer-host'] = { value: 'seanshore.in' }
  const result = handler(incoming)
  assert.equal(result, incoming.request)
  assert.deepEqual(result.headers['x-sns-viewer-host'], { value: 'seanshore.net' })
  // Look-alike hosts are neither redirected nor treated as an alias.
  for (const host of ['wwwseanshore.net', 'www.seanshore.net.example.com', 'mail.seanshore.net']) {
    const other = event(host, '/home')
    assert.equal(handler(other), other.request, host)
  }
})
