import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const templateUrl = new URL('../../infra/aws/app/cloudfront/legacy-domain-redirect.js.tftpl', import.meta.url)

async function loadHandler() {
  const template = await readFile(templateUrl, 'utf8')
  assert.deepEqual([...new Set(template.match(/\$\{[^}]+\}/g) ?? [])], ['${canonical_host}'])
  const code = template.replaceAll('${canonical_host}', 'seanshore.in')
  return new Function(`${code}\nreturn handler;`)()
}

function event(host, uri, querystring = {}) {
  return {
    version: '1.0',
    context: { eventType: 'viewer-request' },
    viewer: { ip: '198.51.100.1' },
    request: { method: 'GET', uri, querystring, headers: host ? { host: { value: host } } : {}, cookies: {} },
  }
}

function location(result) {
  assert.equal(result.statusCode, 301)
  assert.equal(result.statusDescription, 'Moved Permanently')
  return result.headers.location.value
}

test('apex and www of the old domain both land on the new site home page', async () => {
  const handler = await loadHandler()
  assert.equal(location(handler(event('seaandshore.in', '/'))), 'https://seanshore.in/')
  assert.equal(location(handler(event('www.seaandshore.in', '/'))), 'https://seanshore.in/')
  assert.equal(location(handler(event('WWW.SEAANDSHORE.IN', '/index.php'))), 'https://seanshore.in/')
  assert.equal(location(handler(event(undefined, '/index.html'))), 'https://seanshore.in/')
})

test('the old FAQ location and its sub-pages go to the new help page', async () => {
  const handler = await loadHandler()
  for (const uri of ['/FAQs', '/FAQs/', '/FAQs/index.html', '/faqs/index.html', '/FAQs/membership.html']) {
    assert.equal(location(handler(event('seaandshore.in', uri))), 'https://seanshore.in/help', uri)
  }
})

test('known old pages map to their new locations', async () => {
  const handler = await loadHandler()
  const expected = {
    '/about.php': '/about',
    '/contact.php': '/contact',
    '/help.php': '/help',
    '/help.html': '/help',
    '/legal.php': '/terms',
    '/terms-and-conditions.php': '/terms',
    '/privacy-policy.php': '/privacy',
    '/mentor.php': '/',
    '/photo-gallery.php': '/',
    '/pages/Jobs/JobListing.php': '/jobs',
    '/pages/CandidateSearch/CandidateListing.php': '/network',
    '/pages/CommunityMember/CommunityMembers.php': '/community',
    '/pages/Login/ClientLogin.php': '/auth/sign-in',
  }
  for (const [oldPath, newPath] of Object.entries(expected)) {
    assert.equal(location(handler(event('seaandshore.in', oldPath))), `https://seanshore.in${newPath}`, oldPath)
  }
})

test('unknown paths keep the same path so the new site can answer or 404 nicely', async () => {
  const handler = await loadHandler()
  assert.equal(location(handler(event('seaandshore.in', '/help'))), 'https://seanshore.in/help')
  assert.equal(location(handler(event('seaandshore.in', '/people/captain-jane'))), 'https://seanshore.in/people/captain-jane')
  assert.equal(location(handler(event('seaandshore.in', '/Some/Old/Page.php'))), 'https://seanshore.in/Some/Old/Page.php')
})

test('query strings are preserved on every redirect', async () => {
  const handler = await loadHandler()
  assert.equal(
    location(handler(event('seaandshore.in', '/pages/Jobs/JobListing.php', { search: { value: 'Chief Engineers' }, company: { value: 'AZA Shipping' } }))),
    'https://seanshore.in/jobs?search=Chief%20Engineers&company=AZA%20Shipping',
  )
  assert.equal(location(handler(event('seaandshore.in', '/', { ref: { value: 'a', multiValue: [{ value: 'a' }, { value: 'b' }] } }))), 'https://seanshore.in/?ref=a&ref=b')
})
