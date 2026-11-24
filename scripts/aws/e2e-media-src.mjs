// Where an uploaded profile photo may be served from, as the browser E2E sees its <img> src.
//
// With the media CDN on (Round P3, 529404f1), a stored photo is a CloudFront-signed WebP size in its
// own folder on the site's host: /m/i/<32 URL-safe characters>/<320|768|1600>.webp?Policy=…&Signature=…
// &Key-Pair-Id=…. The folder is a hash of the storage key, so "profiles/" no longer appears in it.
// With the CDN off, the photo is a first-party link (optionally through /_next/image) whose path or
// query names the profiles/ storage prefix, as before the CDN. Anything else (a CDN path on another
// host or without its signature, a placeholder) is refused.
const CDN_IMAGE_PATH = /^\/m\/i\/[A-Za-z0-9_-]{32}\/(?:320|768|1600)\.webp$/
const CDN_SIGNATURE_PARAMS = ['Policy', 'Signature', 'Key-Pair-Id']

function unwrapOptimizer(url) {
  if (url.pathname !== '/_next/image') return url
  const inner = url.searchParams.get('url')
  return inner ? new URL(inner, url.origin) : url
}

export function describeProfilePhotoSrc(src, siteUrl) {
  let outer
  try {
    outer = new URL(src, siteUrl)
  } catch {
    return { ok: false, kind: 'unparseable' }
  }
  const site = new URL(siteUrl)
  const url = unwrapOptimizer(outer)
  if (CDN_IMAGE_PATH.test(url.pathname)) {
    if (url.host !== site.host) return { ok: false, kind: 'cdn-other-host' }
    const signed = CDN_SIGNATURE_PARAMS.every((name) => (url.searchParams.get(name) ?? '').length > 0)
    return signed ? { ok: true, kind: 'cdn-signed' } : { ok: false, kind: 'cdn-unsigned' }
  }
  // CDN off: unchanged from before the CDN (a pre-signed storage URL may sit on the bucket's host).
  const named = (url.pathname + url.search).includes('profiles/') || url.search.includes('profiles%2F')
  return named ? { ok: true, kind: 'first-party-profiles' } : { ok: false, kind: 'not-profile-media' }
}
