import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { MEDIA_IMAGE_ROUTE } from './media-image-route'

export { MEDIA_IMAGE_ROUTE, isMediaImageLink } from './media-image-route'

/**
 * Stable, signed first-party links for member photos, covers, logos and banners.
 *
 * Next's image optimizer caches by the full source URL. Pre-signed S3 URLs change every clock
 * hour, so every cached photo went stale at once each hour and the web task re-downloaded and
 * re-encoded all of them together (Round 13: hourly memory spikes and OOM kills). These links
 * stay identical for a 30-day window, so each photo is optimized once per size per window.
 *
 * The optimizer fetches local sources without the visitor's cookies, so the link itself carries
 * the permission: an HMAC over the storage key and window, handed out only by the same server
 * code that used to hand out the pre-signed URL. Links from the previous window keep working, so
 * a link is valid for 30 to 60 days, like a long-lived pre-signed URL.
 */
export const MEDIA_IMAGE_LINK_WINDOW_SECONDS = 30 * 24 * 60 * 60
/** Largest source photo the media route hands the optimizer; bounds what one decode can take. */
export const MEDIA_IMAGE_MAX_BYTES = 15 * 1024 * 1024
const SIGNATURE_LENGTH = 32
const KEY_INFO = 'sea-n-shore/media-image-link/v1'

/**
 * The only storage keys the stable link route serves: public-facing photos (member avatars and
 * covers, organization logos and covers, community icons and covers, event banners). Documents,
 * message attachments, learning files and post media never qualify.
 */
const EXT = '(?:jpe?g|png|webp|gif|avif)'
const SEGMENT = '[A-Za-z0-9_-]{1,128}'
export const MEDIA_IMAGE_KEY_PATTERNS: readonly RegExp[] = [
  new RegExp(`^profiles/${SEGMENT}/(?:avatar|cover)(?:-[A-Za-z0-9_-]{1,64})?\\.${EXT}$`, 'i'),
  new RegExp(`^organizations/${SEGMENT}/(?:logo|cover)-[A-Za-z0-9_-]{1,64}\\.${EXT}$`, 'i'),
  new RegExp(`^communities/${SEGMENT}/(?:icon|cover)-[A-Za-z0-9_-]{1,64}\\.${EXT}$`, 'i'),
  new RegExp(`^events/${SEGMENT}/banners/[A-Za-z0-9_-]{1,64}\\.${EXT}$`, 'i'),
]

type Environment = Record<string, string | undefined>

let cachedKey: { source: string; key: Buffer } | null = null

/**
 * Link-signing key, derived (HKDF, own label) from the realtime ticket secret the web task already
 * holds, so no new secret has to be provisioned. Returns null when it is not configured (local dev),
 * in which case callers keep using pre-signed URLs.
 */
export function mediaImageLinkKey(environment: Environment = process.env): Buffer | null {
  const source = environment.MEDIA_IMAGE_LINK_SECRET?.trim() || environment.REALTIME_TICKET_SECRET?.trim() || ''
  if (source.length < 32) return null
  if (cachedKey?.source === source) return cachedKey.key
  const key = Buffer.from(hkdfSync('sha256', source, Buffer.alloc(0), KEY_INFO, 32))
  cachedKey = { source, key }
  return key
}

export function isMediaImageKey(key: string): boolean {
  if (typeof key !== 'string' || key.length > 400) return false
  return MEDIA_IMAGE_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

/**
 * Window number for a key. Each key's windows are offset by a hash of the key, so links roll over
 * spread across the 30 days instead of all at the same instant (which would be a monthly storm).
 */
export function mediaImageWindow(storageKey: string, now = Date.now()): number {
  const windowMs = MEDIA_IMAGE_LINK_WINDOW_SECONDS * 1000
  const offset = createHash('sha256').update(storageKey).digest().readUInt32BE(0) % windowMs
  return Math.floor((now + offset) / windowMs)
}

function sign(key: Buffer, storageKey: string, window: number): string {
  return createHmac('sha256', key).update(`${storageKey}\n${window}`).digest('base64url').slice(0, SIGNATURE_LENGTH)
}

function encodeKey(storageKey: string): string {
  return storageKey.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

/** Stable link for an image key, or null when the key or signing key does not qualify. */
export function createMediaImageLink(
  storageKey: string,
  options: { now?: number; environment?: Environment } = {},
): string | null {
  if (!isMediaImageKey(storageKey)) return null
  const key = mediaImageLinkKey(options.environment)
  if (!key) return null
  const window = mediaImageWindow(storageKey, options.now)
  return `${MEDIA_IMAGE_ROUTE}/${encodeKey(storageKey)}?w=${window}&s=${sign(key, storageKey, window)}`
}

export type MediaImageLinkCheck =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'bad_key' | 'bad_window' | 'expired' | 'bad_signature' }

/** Checks a link's signature; the current and the previous window are accepted. */
export function verifyMediaImageLink(
  storageKey: string,
  windowParam: string | null,
  signature: string | null,
  options: { now?: number; environment?: Environment } = {},
): MediaImageLinkCheck {
  const key = mediaImageLinkKey(options.environment)
  if (!key) return { ok: false, reason: 'not_configured' }
  if (!isMediaImageKey(storageKey)) return { ok: false, reason: 'bad_key' }
  if (!windowParam || !/^\d{1,8}$/.test(windowParam)) return { ok: false, reason: 'bad_window' }
  const window = Number(windowParam)
  const current = mediaImageWindow(storageKey, options.now)
  if (window !== current && window !== current - 1) return { ok: false, reason: 'expired' }
  const expected = Buffer.from(sign(key, storageKey, window))
  const given = Buffer.from(signature ?? '')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' }
  return { ok: true }
}
