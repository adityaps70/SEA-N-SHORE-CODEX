import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { describeProfilePhotoSrc } from './e2e-media-src.mjs'

const id = 'AbCdEfGhIjKlMnOpQrStUvWxYz012-_9'
const signed = 'Policy=eyJTdGF0ZW1lbnQiOltdfQ__&Signature=abc~def&Key-Pair-Id=K2EXAMPLE&Hash-Algorithm=SHA256'

for (const site of ['https://seanshore.in', 'https://seanshore.net']) {
  test(`a signed CDN photo on ${site} counts as profile media storage`, () => {
    assert.deepEqual(describeProfilePhotoSrc(`/m/i/${id}/768.webp?${signed}`, site), { ok: true, kind: 'cdn-signed' })
    assert.deepEqual(describeProfilePhotoSrc(`${site}/m/i/${id}/320.webp?${signed}`, site), { ok: true, kind: 'cdn-signed' })
    const optimized = `/_next/image?url=${encodeURIComponent(`/m/i/${id}/1600.webp?${signed}`)}&w=96&q=75`
    assert.deepEqual(describeProfilePhotoSrc(optimized, site), { ok: true, kind: 'cdn-signed' })
  })
}

test('a CDN photo path is refused without its signature, on another host, or in a bad folder', () => {
  const site = 'https://seanshore.net'
  assert.equal(describeProfilePhotoSrc(`/m/i/${id}/768.webp`, site).kind, 'cdn-unsigned')
  assert.equal(describeProfilePhotoSrc(`/m/i/${id}/768.webp?Policy=x&Key-Pair-Id=K`, site).kind, 'cdn-unsigned')
  assert.equal(describeProfilePhotoSrc(`https://seanshore.in/m/i/${id}/768.webp?${signed}`, site).kind, 'cdn-other-host')
  assert.equal(describeProfilePhotoSrc(`https://d3prih0q6jofyr.cloudfront.net/m/i/${id}/768.webp?${signed}`, site).kind, 'cdn-other-host')
  // A post photo folder, a file folder, a short id, an unknown size: none is a stored photo size.
  for (const path of [`/m/f/${id}/file.gif`, `/m/i/short/768.webp`, `/m/i/${id}/999.webp`, `/m/i/${id}/768.png`]) {
    assert.equal(describeProfilePhotoSrc(`${path}?${signed}`, site).ok, false, path)
  }
})

test('with the CDN off, a first-party profiles/ link still counts, as before', () => {
  const site = 'https://seanshore.net'
  assert.equal(describeProfilePhotoSrc('/api/media/image/profiles/u1/avatar.webp?sig=1', site).kind, 'first-party-profiles')
  assert.equal(describeProfilePhotoSrc('/_next/image?url=%2Fapi%2Fmedia%2Fimage%2Fprofiles%2Fu1%2Fa.png&w=96', site).kind, 'first-party-profiles')
})

test('placeholders and other media are refused', () => {
  const site = 'https://seanshore.net'
  assert.equal(describeProfilePhotoSrc('/images/default-avatar.svg', site).kind, 'not-profile-media')
  assert.equal(describeProfilePhotoSrc('/api/media/image/posts/p1/photo.webp', site).kind, 'not-profile-media')
  assert.equal(describeProfilePhotoSrc('data:image/png;base64,AAAA', site).ok, false)
  assert.equal(describeProfilePhotoSrc('http://[bad', site).kind, 'unparseable')
})

test('the feed avatar E2E uses this check for the uploaded photo, and nothing looser', () => {
  const source = readFileSync(new URL('./feed-avatar-staging-e2e.mjs', import.meta.url), 'utf8')
  assert.match(source, /import \{ describeProfilePhotoSrc \} from '\.\/e2e-media-src\.mjs'/)
  assert.match(source, /assert\.ok\(source\.ok, 'Uploaded profile avatar should resolve from profile media storage/)
  assert.doesNotMatch(source, /state\.src\.includes\('\/profiles\/'\)/)
  // A change to this check re-runs the onboarding workflow's plan, and infra CI runs this test.
  assert.match(readFileSync('.github/workflows/aws-onboarding-e2e.yml', 'utf8'), /- scripts\/aws\/e2e-media-src\.mjs/)
  assert.match(readFileSync('.github/workflows/aws-infra-ci.yml', 'utf8'), /node --test scripts\/aws\/e2e-media-src\.test\.mjs/)
})
