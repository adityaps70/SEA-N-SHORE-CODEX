// @vitest-environment node
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { imageVariantKey, mediaCdnFileKey } from '@/lib/media-cdn/cdn-keys'
import {
  MEDIA_CDN_PROBE_KEY,
  REENCODED_METADATA_KEY,
  collectStoredMedia,
  reencodeOriginal,
  runMediaCdnBackfillApply,
  runMediaCdnBackfillPlan,
  type BackfillDeps,
} from './media-cdn-backfill-task'

const POST = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222'
const ARTICLE_IMAGE = 'learning/u1/33333333-3333-4333-8333-333333333333/lesson_image/44444444-4444-4444-8444-444444444444.png'

function fakeBucket(objects: Record<string, { type: string; body?: Buffer; metadata?: Record<string, string> }>) {
  const store = new Map(Object.entries(objects).map(([key, value]) => [key, { ...value, body: value.body ?? Buffer.from('x') }]))
  const lines: string[] = []
  const rows: Record<string, Array<Record<string, unknown>>> = {}
  const deps: BackfillDeps = {
    query: async (sql) => {
      for (const [needle, result] of Object.entries(rows)) if (sql.includes(needle)) return result
      return []
    },
    exists: async (key) => store.has(key),
    head: async (key) => {
      const object = store.get(key)
      if (!object) throw new Error('missing')
      return { contentType: object.type, contentLength: object.body.byteLength, metadata: object.metadata ?? {} }
    },
    read: async (key) => store.get(key)!.body,
    put: async ({ key, body, contentType, metadata }) => {
      store.set(key, { type: contentType, body, metadata })
    },
    writeVariants: async (key) => {
      for (const width of [320, 768, 1600] as const) store.set(imageVariantKey(key, width), { type: 'image/webp', body: Buffer.from('v') })
    },
    copyFile: async (key, contentType) => {
      store.set(mediaCdnFileKey(key, contentType === 'video/mp4' ? 'mp4' : contentType === 'image/gif' ? 'gif' : 'webm'), { type: contentType, body: Buffer.from('c') })
    },
    log: (line) => lines.push(line),
  }
  return { deps, store, lines, rows }
}

async function jpegWithExif(width = 3000, height = 1500) {
  return sharp({ create: { width, height, channels: 3, background: '#224466' } })
    .jpeg()
    .withExif({ IFD0: { Artist: 'Someone' } })
    .toBuffer()
}

describe('media CDN backfill', () => {
  it('collects every stored photo, video and GIF the site shows, once each', async () => {
    const { deps, rows } = fakeBucket({})
    rows['from public.profiles'] = [{ key: 'profiles/p/avatar-1.jpg' }, { key: 'profiles/p/cover-1.webp' }]
    rows['from public.companies'] = [{ key: 'organizations/o/logo-1.png' }]
    rows['from public.post_media'] = [{ key: `${POST}/a.jpg`, mime_type: 'image/jpeg' }, { key: `${POST}/b.mp4`, mime_type: 'video/mp4' }, { key: `${POST}/c.pdf`, mime_type: 'application/pdf' }]
    rows['from public.messages'] = [{ key: 'messages/p/c/d.gif', mime_type: 'image/gif' }]
    rows["article_format = 'html'"] = [{ article_body: `<p>x</p><img data-storage-path="${ARTICLE_IMAGE}" alt="">` }]
    rows["key = 'about_page'"] = [{ value: { founders: [{ photoPath: 'site/about/f.jpg' }], team: [{ photoPath: null }], partners: [{ logoPath: 'site/about/l.png' }, { logoPath: 'site/about/l.png' }] } }]

    const media = await collectStoredMedia(deps)
    expect(media.map((item) => [item.kind, item.key, item.contentType])).toEqual([
      ['profile', 'profiles/p/avatar-1.jpg', 'image/jpeg'],
      ['profile', 'profiles/p/cover-1.webp', 'image/webp'],
      ['organization', 'organizations/o/logo-1.png', 'image/png'],
      ['post', `${POST}/a.jpg`, 'image/jpeg'],
      ['post', `${POST}/b.mp4`, 'video/mp4'],
      ['message', 'messages/p/c/d.gif', 'image/gif'],
      ['article', ARTICLE_IMAGE, 'image/png'],
      ['about', 'site/about/f.jpg', 'image/jpeg'],
      ['about', 'site/about/l.png', 'image/png'],
    ])
  })

  it('plans with counts only and changes nothing', async () => {
    const { deps, store, lines, rows } = fakeBucket({
      'profiles/p/avatar-1.jpg': { type: 'image/jpeg', body: Buffer.alloc(2 * 1048576) },
      [`${POST}/b.mp4`]: { type: 'video/mp4' },
    })
    rows['from public.profiles'] = [{ key: 'profiles/p/avatar-1.jpg' }, { key: 'profiles/q/avatar-gone.jpg' }]
    rows['from public.post_media'] = [{ key: `${POST}/b.mp4`, mime_type: 'video/mp4' }]
    const before = new Map(store)

    await runMediaCdnBackfillPlan(deps)

    expect(store).toEqual(before)
    expect(lines).toContain('MEDIA_CDN_BACKFILL_PLAN_KIND kind=profile total=2 cdn_missing=1 reencode=1 reencode_mb=2.0 not_in_bucket=1')
    expect(lines).toContain('MEDIA_CDN_BACKFILL_PLAN_KIND kind=post total=1 cdn_missing=1 reencode=0 reencode_mb=0.0 not_in_bucket=0')
    expect(lines).toContain('MEDIA_CDN_BACKFILL_PLAN_TOTAL cdn_missing=2 reencode=1 reencode_mb=2.0')
    expect(lines.at(-1)).toBe('MEDIA_CDN_BACKFILL_PLAN_VERIFIED=true')
    expect(lines.join('\n')).not.toMatch(/profiles\/|messages\/|\.jpg|\.mp4/)
  })

  it('re-encodes originals in place once, writes the missing CDN copies and the probe, and leaves message photos as sent', async () => {
    const { deps, store, lines, rows } = fakeBucket({
      'profiles/p/avatar-1.jpg': { type: 'image/jpeg', body: await jpegWithExif() },
      [`${POST}/b.mp4`]: { type: 'video/mp4' },
      'messages/p/c/d.jpg': { type: 'image/jpeg', body: await jpegWithExif(100, 100) },
    })
    rows['from public.profiles'] = [{ key: 'profiles/p/avatar-1.jpg' }]
    rows['from public.post_media'] = [{ key: `${POST}/b.mp4`, mime_type: 'video/mp4' }]
    rows['from public.messages'] = [{ key: 'messages/p/c/d.jpg', mime_type: 'image/jpeg' }]
    const messageBefore = store.get('messages/p/c/d.jpg')!.body

    await runMediaCdnBackfillApply(deps)

    const avatar = store.get('profiles/p/avatar-1.jpg')!
    expect(avatar.metadata).toEqual({ [REENCODED_METADATA_KEY]: 'p3' })
    const meta = await sharp(avatar.body).metadata()
    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width!, meta.height!)).toBe(2048)
    expect(meta.exif).toBeUndefined()
    expect(store.has(imageVariantKey('profiles/p/avatar-1.jpg', 1600))).toBe(true)
    expect(store.has(mediaCdnFileKey(`${POST}/b.mp4`, 'mp4'))).toBe(true)
    expect(store.get('messages/p/c/d.jpg')!.body).toBe(messageBefore)
    expect(store.has(imageVariantKey('messages/p/c/d.jpg', 1600))).toBe(true)
    expect(store.has(MEDIA_CDN_PROBE_KEY)).toBe(true)
    expect(lines).toContain('MEDIA_CDN_BACKFILL_APPLIED reencoded=1 cdn_prepared=2 failures=0')
    expect(lines).toContain('MEDIA_CDN_BACKFILL_AFTER_TOTAL cdn_missing=0 reencode=0 reencode_mb=0.0')
    expect(lines.at(-1)).toBe('MEDIA_CDN_BACKFILL_COMPLETE=true')

    // A second run has nothing left to do.
    lines.length = 0
    await runMediaCdnBackfillApply(deps)
    expect(lines).toContain('MEDIA_CDN_BACKFILL_APPLIED reencoded=0 cdn_prepared=0 failures=0')
  })

  it('fails loudly when anything is left missing', async () => {
    const { deps, rows } = fakeBucket({ 'profiles/p/avatar-1.webp': { type: 'image/webp' } })
    rows['from public.profiles'] = [{ key: 'profiles/p/avatar-1.webp' }]
    deps.writeVariants = async () => { throw new Error('sharp') }
    await expect(runMediaCdnBackfillApply(deps)).rejects.toThrow('media_cdn_backfill_incomplete failures=1 missing=1 reencode=0')
  })

  it('keeps PNG transparency and the original format when re-encoding', async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const meta = await sharp(await reencodeOriginal(png, 'image/png')).metadata()
    expect(meta.format).toBe('png')
    expect(meta.hasAlpha).toBe(true)
    expect(meta.width).toBe(64)
  })
})
