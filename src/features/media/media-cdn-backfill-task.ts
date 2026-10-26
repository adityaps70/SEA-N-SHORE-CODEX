import sharp from 'sharp'
import { articleImagePaths } from '@/features/learning/article-html'
import { imageVariantKey, isImageVariantSource, mediaCdnFileExtension, mediaCdnFileKey } from '@/lib/media-cdn/cdn-keys'
import { IMAGE_VARIANT_SOURCE_MAX_BYTES } from '@/lib/media-cdn/prepare-media'

/**
 * Round P3 (B7, Part D): the one-off media backfill, run as an ECS task by
 * scripts/aws/media-cdn-backfill.sh with the web task's own database and bucket access.
 *
 * - plan (read only): counts, per kind, of stored photos, videos and GIFs that are missing their
 *   CDN copy, and of JPEG/PNG originals not yet re-encoded (with their total size).
 * - apply-once: re-encodes each JPEG/PNG original in place (same key and format, at most 2048 px,
 *   all metadata including EXIF and GPS removed; S3 versioning keeps the previous version until a
 *   separately approved clean-up), then writes the missing CDN sizes and copies, and finally checks
 *   that nothing is missing.
 *
 * It prints counts only: never a key, name, path or file content.
 */

export type MediaKind =
  | 'profile' | 'organization' | 'community' | 'event' | 'post' | 'message' | 'course' | 'lesson' | 'article' | 'about'

export type StoredMedia = { kind: MediaKind; key: string; contentType: string }

type Row = Record<string, unknown>

export type BackfillDeps = {
  query: (text: string, values?: readonly unknown[]) => Promise<Row[]>
  exists: (key: string) => Promise<boolean>
  head: (key: string) => Promise<{ contentType: string | null; contentLength: number | null; metadata?: Record<string, string> }>
  read: (key: string, maxBytes: number) => Promise<Uint8Array>
  put: (input: { key: string; body: Buffer; contentType: string; cacheControl?: string; metadata?: Record<string, string> }) => Promise<void>
  writeVariants: (key: string, body: Uint8Array) => Promise<void>
  copyFile: (sourceKey: string, contentType: string) => Promise<void>
  log: (line: string) => void
}

/** Marks an original this backfill has re-encoded, so a second run leaves it alone. */
export const REENCODED_METADATA_KEY = 'sns-reencoded'
export const REENCODED_METADATA_VALUE = 'p3'
export const REENCODE_MAX_EDGE_PX = 2048
/** A signed probe object the enable step reads through CloudFront to prove the whole path works. */
export const MEDIA_CDN_PROBE_KEY = 'm/_probe/backfill.txt'
export const MEDIA_CDN_PROBE_BODY = 'sea-n-shore media cdn probe\n'

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm',
}

function typeFromKey(key: string): string | null {
  return TYPE_BY_EXTENSION[key.slice(key.lastIndexOf('.') + 1).toLowerCase()] ?? null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Every stored photo, video and GIF the site shows, from the columns that reference them. */
export async function collectStoredMedia(deps: Pick<BackfillDeps, 'query'>): Promise<StoredMedia[]> {
  const found = new Map<string, StoredMedia>()
  const add = (kind: MediaKind, key: string | null, contentType?: string | null) => {
    if (!key || found.has(key)) return
    const type = (contentType ?? typeFromKey(key))?.split(';', 1)[0]?.trim().toLowerCase()
    if (!type) return
    if (!type.startsWith('image/') && !type.startsWith('video/')) return
    found.set(key, { kind, key, contentType: type })
  }

  const columns: Array<[MediaKind, string]> = [
    ['profile', 'select avatar_path as key from public.profiles where avatar_path is not null union all select cover_path from public.profiles where cover_path is not null'],
    ['organization', 'select logo_path as key from public.companies where logo_path is not null union all select cover_path from public.companies where cover_path is not null'],
    ['community', 'select icon_path as key from public.community_groups where icon_path is not null union all select cover_path from public.community_groups where cover_path is not null'],
    ['event', "select banner_url as key from public.events where banner_url like 'events/%'"],
    ['course', 'select thumbnail_path as key from public.learning_courses where thumbnail_path is not null'],
    ['lesson', "select asset_path as key from public.learning_lessons where lesson_type = 'image' and asset_path is not null"],
  ]
  for (const [kind, sql] of columns) {
    for (const row of await deps.query(sql)) add(kind, text(row.key))
  }
  for (const row of await deps.query('select storage_path as key, mime_type from public.post_media')) {
    add('post', text(row.key), text(row.mime_type))
  }
  for (const row of await deps.query(
    "select attachment_storage_path as key, attachment_mime_type as mime_type from public.messages where attachment_storage_path is not null and (attachment_mime_type like 'image/%' or attachment_mime_type like 'video/%')",
  )) {
    add('message', text(row.key), text(row.mime_type))
  }
  for (const row of await deps.query(
    "select article_body from public.learning_lessons where article_format = 'html' and article_body like '%data-storage-path%'",
  )) {
    for (const path of articleImagePaths(String(row.article_body ?? ''))) add('article', path)
  }
  for (const row of await deps.query("select value from public.site_settings where key = 'about_page'")) {
    const about = (row.value ?? {}) as { founders?: Array<{ photoPath?: unknown }>; team?: Array<{ photoPath?: unknown }>; partners?: Array<{ logoPath?: unknown }> }
    for (const person of [...(about.founders ?? []), ...(about.team ?? [])]) add('about', text(person?.photoPath))
    for (const partner of about.partners ?? []) add('about', text(partner?.logoPath))
  }
  return [...found.values()]
}

function isPhoto(item: StoredMedia) {
  return item.contentType.startsWith('image/') && item.contentType !== 'image/gif' && isImageVariantSource(item.key)
}

/** Messages keep their originals as sent (their size is shown and they can be downloaded). */
function isReencodeCandidate(item: StoredMedia) {
  return item.kind !== 'message' && (item.contentType === 'image/jpeg' || item.contentType === 'image/png') && isPhoto(item)
}

async function cdnCopyMissing(deps: BackfillDeps, item: StoredMedia): Promise<boolean> {
  if (isPhoto(item)) return !(await deps.exists(imageVariantKey(item.key, 1600)))
  const extension = mediaCdnFileExtension(item.contentType)
  if (!extension) return false
  return !(await deps.exists(mediaCdnFileKey(item.key, extension)))
}

type KindCounts = { total: number; missing: number; reencode: number; reencodeBytes: number; unavailable: number }

async function survey(deps: BackfillDeps, media: StoredMedia[]) {
  const counts = new Map<MediaKind, KindCounts>()
  const missing: StoredMedia[] = []
  const reencode: StoredMedia[] = []
  for (const item of media) {
    const entry = counts.get(item.kind) ?? { total: 0, missing: 0, reencode: 0, reencodeBytes: 0, unavailable: 0 }
    counts.set(item.kind, entry)
    entry.total += 1
    let head: Awaited<ReturnType<BackfillDeps['head']>>
    try {
      head = await deps.head(item.key)
    } catch {
      // Referenced but not in the bucket (a deleted or never-finished upload): nothing to serve.
      entry.unavailable += 1
      continue
    }
    if (isReencodeCandidate(item) && head.metadata?.[REENCODED_METADATA_KEY] !== REENCODED_METADATA_VALUE) {
      entry.reencode += 1
      entry.reencodeBytes += head.contentLength ?? 0
      reencode.push(item)
    }
    if (await cdnCopyMissing(deps, item)) {
      entry.missing += 1
      missing.push(item)
    }
  }
  return { counts, missing, reencode }
}

function report(deps: BackfillDeps, prefix: string, counts: Map<MediaKind, KindCounts>) {
  let missing = 0
  let reencode = 0
  let reencodeBytes = 0
  for (const [kind, entry] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    deps.log(`${prefix}_KIND kind=${kind} total=${entry.total} cdn_missing=${entry.missing} reencode=${entry.reencode} reencode_mb=${(entry.reencodeBytes / 1048576).toFixed(1)} not_in_bucket=${entry.unavailable}`)
    missing += entry.missing
    reencode += entry.reencode
    reencodeBytes += entry.reencodeBytes
  }
  deps.log(`${prefix}_TOTAL cdn_missing=${missing} reencode=${reencode} reencode_mb=${(reencodeBytes / 1048576).toFixed(1)}`)
  return { missing, reencode }
}

/** Same format, at most 2048 px on the long edge, no metadata (sharp keeps none unless asked). */
export async function reencodeOriginal(source: Uint8Array, contentType: 'image/jpeg' | 'image/png'): Promise<Buffer> {
  const image = sharp(source, { limitInputPixels: 50_000_000, sequentialRead: true })
    .rotate()
    .resize({ width: REENCODE_MAX_EDGE_PX, height: REENCODE_MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
  return contentType === 'image/jpeg'
    ? image.jpeg({ quality: 85, mozjpeg: true }).toBuffer()
    : image.png({ compressionLevel: 9 }).toBuffer()
}

export async function runMediaCdnBackfillPlan(deps: BackfillDeps) {
  const media = await collectStoredMedia(deps)
  const { counts } = await survey(deps, media)
  report(deps, 'MEDIA_CDN_BACKFILL_PLAN', counts)
  deps.log('MEDIA_CDN_BACKFILL_PLAN_VERIFIED=true')
}

export async function runMediaCdnBackfillApply(deps: BackfillDeps) {
  const media = await collectStoredMedia(deps)
  const before = await survey(deps, media)
  report(deps, 'MEDIA_CDN_BACKFILL_BEFORE', before.counts)

  let failures = 0
  let reencoded = 0
  const rewritten = new Set<string>()
  for (const item of before.reencode) {
    try {
      const body = await reencodeOriginal(await deps.read(item.key, IMAGE_VARIANT_SOURCE_MAX_BYTES), item.contentType as 'image/jpeg' | 'image/png')
      await deps.put({ key: item.key, body, contentType: item.contentType, metadata: { [REENCODED_METADATA_KEY]: REENCODED_METADATA_VALUE } })
      await deps.writeVariants(item.key, body)
      rewritten.add(item.key)
      reencoded += 1
    } catch {
      failures += 1
    }
  }
  let prepared = 0
  for (const item of before.missing) {
    if (rewritten.has(item.key)) continue
    try {
      if (isPhoto(item)) await deps.writeVariants(item.key, await deps.read(item.key, IMAGE_VARIANT_SOURCE_MAX_BYTES))
      else await deps.copyFile(item.key, item.contentType)
      prepared += 1
    } catch {
      failures += 1
    }
  }
  await deps.put({ key: MEDIA_CDN_PROBE_KEY, body: Buffer.from(MEDIA_CDN_PROBE_BODY), contentType: 'text/plain; charset=utf-8' })
  deps.log(`MEDIA_CDN_BACKFILL_APPLIED reencoded=${reencoded} cdn_prepared=${prepared} failures=${failures}`)

  const after = await survey(deps, media)
  const remaining = report(deps, 'MEDIA_CDN_BACKFILL_AFTER', after.counts)
  if (failures > 0 || remaining.missing > 0 || remaining.reencode > 0) {
    throw new Error(`media_cdn_backfill_incomplete failures=${failures} missing=${remaining.missing} reencode=${remaining.reencode}`)
  }
  deps.log('MEDIA_CDN_BACKFILL_COMPLETE=true')
}
