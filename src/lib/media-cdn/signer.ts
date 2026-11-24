import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto'

/**
 * CloudFront signed URLs for the media behaviour (`/m/*`), which accepts nothing unsigned.
 *
 * A custom policy is signed with the distribution's ECDSA P-256 key (SHA-256, so the query carries
 * `Hash-Algorithm=SHA256`). One policy covers a whole folder (`/m/i/<id>/*`), so every size of a
 * photo shares one signature. Expiry is windowed per folder, like the stable image links before it:
 * the same folder gets the byte-identical query for a whole window, so browsers and the CDN reuse
 * what they already downloaded, and a query is valid for one to two windows.
 *
 * - `public` (member photos, logos, covers, banners, course thumbnails): 30-day windows, as the
 *   stable links had.
 * - `private` (post, message and lesson media): 6-hour windows, so a link copied out of a post a
 *   viewer can no longer see stops working within 12 hours.
 */
export type MediaCdnAccess = 'public' | 'private' | 'lesson'

/**
 * - `lesson` (Round P3, Part D: paid lesson videos): 1-hour windows; the lesson player fetches a fresh query
 *   before it expires.
 */
export const MEDIA_CDN_WINDOW_SECONDS: Record<MediaCdnAccess, number> = {
  public: 30 * 24 * 60 * 60,
  private: 6 * 60 * 60,
  lesson: 60 * 60,
}

type Environment = Record<string, string | undefined>

type SigningConfig = { key: KeyObject; keyPairId: string; origin: string }

let cached: { source: string; config: SigningConfig } | null = null

/**
 * Signing settings from the web task: the private key (Secrets Manager), the CloudFront public key
 * id and the site origin (signing is on only for an https site; the policy itself names any host). Null when any is missing (local dev, tests, or before the
 * key is rolled out), in which case callers keep the first-party URLs.
 */
export function mediaCdnSigningConfig(environment: Environment = process.env): SigningConfig | null {
  const pem = environment.MEDIA_CDN_SIGNING_KEY?.trim() ?? ''
  const keyPairId = environment.MEDIA_CDN_KEY_PAIR_ID?.trim() ?? ''
  const origin = (environment.MEDIA_CDN_ORIGIN?.trim() || environment.NEXT_PUBLIC_SITE_URL?.trim() || '').replace(/\/+$/, '')
  if (!pem || !/^K[A-Z0-9]{6,32}$/.test(keyPairId) || !/^https:\/\/[a-z0-9.-]+$/.test(origin)) return null
  const source = `${keyPairId}\n${origin}\n${pem}`
  if (cached?.source === source) return cached.config
  let key: KeyObject
  try {
    key = createPrivateKey(pem)
  } catch {
    return null
  }
  if (key.asymmetricKeyType !== 'ec') return null
  const config = { key, keyPairId, origin }
  cached = { source, config }
  return config
}

function urlSafeBase64(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~')
}

/** Expiry (epoch seconds) for a folder: the end of the window after the current one. */
export function mediaCdnExpiry(folder: string, access: MediaCdnAccess, now = Date.now()): number {
  const windowSeconds = MEDIA_CDN_WINDOW_SECONDS[access]
  const offset = createHash('sha256').update(folder).digest().readUInt32BE(0) % windowSeconds
  const nowSeconds = Math.floor(now / 1000)
  const window = Math.floor((nowSeconds + offset) / windowSeconds)
  return (window + 2) * windowSeconds - offset
}

/**
 * Domain move: the policy names any host, so one signed link works on every name the main distribution
 * answers on (seanshore.in, seanshore.net, its CloudFront name) and keeps working through the switch. It
 * stays as narrow as before: only the main distribution trusts this key group (the edge audit checks it), and
 * the policy still names one folder. Folders are exactly `m/<kind>/<id>` with no wildcard or slash in the id.
 */
export const MEDIA_CDN_POLICY_HOST = 'https://*'
const MEDIA_CDN_FOLDER = /^m\/[a-z]\/[A-Za-z0-9_-]+$/

/** The policy resource for a folder: any host, that folder only. */
export function mediaCdnResource(folder: string): string {
  return `${MEDIA_CDN_POLICY_HOST}/${folder}/*`
}

const QUERY_CACHE_LIMIT = 5000
const queryCache = new Map<string, string>()

/** Policy JSON exactly as CloudFront wants it: no whitespace, one statement. */
export function mediaCdnPolicy(resource: string, expiresAt: number): string {
  return JSON.stringify({ Statement: [{ Resource: resource, Condition: { DateLessThan: { 'AWS:EpochTime': expiresAt } } }] })
}

/**
 * Signed query (without the leading `?`) for every object under `folder` (a key prefix such as
 * `m/i/<id>`), on any host the main distribution serves, or null when signing is not configured or the
 * folder is not a media folder.
 */
export function signMediaCdnFolder(
  folder: string,
  access: MediaCdnAccess,
  options: { now?: number; environment?: Environment } = {},
): string | null {
  const config = mediaCdnSigningConfig(options.environment)
  if (!config || !MEDIA_CDN_FOLDER.test(folder)) return null
  const resource = mediaCdnResource(folder)
  const expiresAt = mediaCdnExpiry(folder, access, options.now)
  const cacheKey = `${config.keyPairId}\n${resource}\n${expiresAt}`
  const hit = queryCache.get(cacheKey)
  if (hit) {
    queryCache.delete(cacheKey)
    queryCache.set(cacheKey, hit)
    return hit
  }
  const policy = mediaCdnPolicy(resource, expiresAt)
  const signature = sign('sha256', Buffer.from(policy), { key: config.key, dsaEncoding: 'der' })
  const query = `Policy=${urlSafeBase64(Buffer.from(policy))}&Signature=${urlSafeBase64(signature)}&Key-Pair-Id=${config.keyPairId}&Hash-Algorithm=SHA256`
  queryCache.set(cacheKey, query)
  if (queryCache.size > QUERY_CACHE_LIMIT) queryCache.delete(queryCache.keys().next().value!)
  return query
}
