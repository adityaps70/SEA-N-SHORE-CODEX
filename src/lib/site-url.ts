import { publicEnvironment } from '@/lib/env'

/**
 * Absolute URL on the public site (NEXT_PUBLIC_SITE_URL, from scripts/aws/public-site-url.txt).
 *
 * Route handlers must not derive absolute URLs from `request.url`: behind CloudFront and the ALB
 * the container sees its own listen address, so redirects and links built from the request would
 * point at `localhost:3000` instead of the public site.
 */
export function siteUrlFor(path: string): URL {
  return new URL(path, publicEnvironment.NEXT_PUBLIC_SITE_URL)
}

/** The public site origin without a trailing slash, e.g. `https://example.org`. */
export function siteOrigin(): string {
  return new URL(publicEnvironment.NEXT_PUBLIC_SITE_URL).origin
}

/**
 * Domain move: the CloudFront viewer-request function copies the host the visitor used into this
 * header (it always overwrites whatever a client sent). The container cannot see it otherwise: CloudFront sends the
 * origin's own Host and a fixed X-Forwarded-Host.
 */
export const VIEWER_HOST_HEADER = 'x-sns-viewer-host'

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/** Parses a comma- or newline-separated host list; anything that is not a plain hostname is dropped. */
export function parseSiteAliasHosts(value: string | undefined | null): string[] {
  return [...new Set((value ?? '').split(/[\s,]+/).map((host) => host.trim().toLowerCase()).filter((host) => HOSTNAME.test(host)))]
}

/**
 * The other hosts the site answers on during a domain move (scripts/aws/site-alias-hosts.txt, inlined into the build
 * by next.config.ts as SITE_ALIAS_HOSTS). Empty outside a move.
 */
export function siteAliasHosts(): string[] {
  return parseSiteAliasHosts(process.env.SITE_ALIAS_HOSTS)
}

type HeaderSource = { get(name: string): string | null } | null | undefined

/**
 * The origin to send this visitor back to: the host they are on when it is the canonical host or one of the alias
 * hosts (https only), else the canonical origin. Used for redirects a member follows and for the URLs a provider
 * returns them to (Google sign-in, Cashfree checkout), so a visitor on an alias host stays on it. Canonical links
 * (sitemap, robots, emails, SEO) keep using siteOrigin().
 */
export function siteOriginFor(
  headers: HeaderSource,
  config: { canonical: string; aliases: string[] } = { canonical: siteOrigin(), aliases: siteAliasHosts() },
): string {
  const canonical = new URL(config.canonical)
  const host = headers?.get(VIEWER_HOST_HEADER)?.trim().toLowerCase()
  if (!host || host === canonical.host || canonical.protocol !== 'https:') return canonical.origin
  return config.aliases.includes(host) ? `https://${host}` : canonical.origin
}

/** Absolute URL on the origin this visitor is on (see siteOriginFor). */
export function siteUrlForRequest(headers: HeaderSource, path: string): URL {
  return new URL(path, siteOriginFor(headers))
}

/** Every origin the site itself serves: the canonical one first, then the alias hosts (https). */
export function siteOrigins(): string[] {
  return [siteOrigin(), ...siteAliasHosts().map((host) => `https://${host}`)]
}
