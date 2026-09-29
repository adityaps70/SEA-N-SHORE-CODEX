import { publicEnvironment } from '@/lib/env'

/**
 * Absolute URL on the public site (NEXT_PUBLIC_SITE_URL).
 *
 * Route handlers must not derive absolute URLs from `request.url`: behind CloudFront and the ALB
 * the container sees its own listen address, so redirects and links built from the request would
 * point at `localhost:3000` instead of https://seanshore.in.
 */
export function siteUrlFor(path: string): URL {
  return new URL(path, publicEnvironment.NEXT_PUBLIC_SITE_URL)
}

/** The public site origin without a trailing slash, e.g. `https://seanshore.in`. */
export function siteOrigin(): string {
  return new URL(publicEnvironment.NEXT_PUBLIC_SITE_URL).origin
}
