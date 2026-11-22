/**
 * Owner (21 Nov): a request the browser or Next.js made in the background, not one a person asked for: a Next.js
 * router prefetch (`<Link>` in view or hovered sends `rsc: 1` and `next-router-prefetch: 1`) or a browser speculative
 * prefetch (`Sec-Purpose: prefetch`, or the older `Purpose: prefetch`). Routes that do heavy work or change something
 * on GET answer these at once and do nothing. The 21 Nov 05:36-05:38 UTC latency spike came from Next.js prefetching
 * certificate download links: each prefetch issued the certificate if needed and built its PDF on the web server.
 */
export function isBackgroundFetch(headers: Pick<Headers, 'get'>) {
  if (headers.get('rsc') === '1' || headers.get('next-router-prefetch') || headers.get('next-router-segment-prefetch')) return true
  const purpose = `${headers.get('sec-purpose') ?? ''} ${headers.get('purpose') ?? ''}`.toLowerCase()
  return /\bprefetch\b/.test(purpose)
}

/** The answer to a background request on a heavy or side-effect route: nothing, and never cached. */
export function backgroundFetchRefused() {
  return new Response(null, { status: 204, headers: { 'cache-control': 'private, no-store' } })
}
