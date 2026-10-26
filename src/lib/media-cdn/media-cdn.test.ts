// @vitest-environment node
import { generateKeyPairSync, verify } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  copyMediaObject: vi.fn<(input: unknown) => Promise<void>>(async () => undefined),
  getMediaObject: vi.fn(),
  mediaObjectExists: vi.fn<(key: string) => Promise<boolean>>(async () => false),
  putMediaObject: vi.fn<(input: unknown) => Promise<void>>(async () => undefined),
}))
vi.mock('@/lib/aws/storage', () => storage)

import { imageVariantKey, imageVariantKeys, isImageVariantSource, mediaCdnFileKey, mediaCdnId } from './cdn-keys'
import { cdnImageSrcSet, cdnImageUrlForWidth, imageVariantWidthFor, isCdnImageUrl } from './cdn-url'
import { cdnFileUrl, cdnImageSrc, cdnMediaUrl, mediaCdnAccessFor, mediaCdnEnabled } from './media-cdn'
import { cdnImageRedirect } from './cdn-redirect'
import { prepareMediaForCdn, renderImageVariants } from './prepare-media'
import { MEDIA_CDN_WINDOW_SECONDS, mediaCdnExpiry, mediaCdnPolicy, mediaCdnSigningConfig, signMediaCdnFolder } from './signer'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const ENV = { MEDIA_CDN_SIGNING_KEY: PEM, MEDIA_CDN_KEY_PAIR_ID: 'K2JCJMDEHXQW5F', NEXT_PUBLIC_SITE_URL: 'https://seanshore.in' }

function fromUrlSafe(value: string) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/'), 'base64')
}

function parseQuery(query: string) {
  return Object.fromEntries(query.split('&').map((part) => {
    const index = part.indexOf('=')
    return [part.slice(0, index), part.slice(index + 1)]
  }))
}

describe('CloudFront signing', () => {
  it('signs a folder policy that verifies with the public key, with SHA-256 named in the query', () => {
    const query = signMediaCdnFolder('m/i/abc', 'private', { environment: ENV, now: Date.UTC(2026, 9, 26) })!
    const params = parseQuery(query)
    expect(Object.keys(params)).toEqual(['Policy', 'Signature', 'Key-Pair-Id', 'Hash-Algorithm'])
    expect(params['Key-Pair-Id']).toBe('K2JCJMDEHXQW5F')
    expect(params['Hash-Algorithm']).toBe('SHA256')
    const policy = fromUrlSafe(params.Policy!).toString()
    expect(policy).not.toMatch(/\s/)
    const statement = JSON.parse(policy).Statement
    expect(statement).toHaveLength(1)
    expect(statement[0].Resource).toBe('https://seanshore.in/m/i/abc/*')
    expect(verify('sha256', Buffer.from(policy), { key: publicKey, dsaEncoding: 'der' }, fromUrlSafe(params.Signature!))).toBe(true)
  })

  it('uses only URL-safe characters', () => {
    const query = signMediaCdnFolder('m/i/abc', 'public', { environment: ENV })!
    const { Policy, Signature } = parseQuery(query)
    expect(Policy).toMatch(/^[A-Za-z0-9_~-]+$/)
    expect(Signature).toMatch(/^[A-Za-z0-9_~-]+$/)
  })

  it('gives the same query for a whole window and expires one to two windows ahead', () => {
    const start = Date.UTC(2026, 9, 26, 3)
    const expiry = mediaCdnExpiry('m/i/abc', 'private', start)
    const window = MEDIA_CDN_WINDOW_SECONDS.private
    expect(expiry - start / 1000).toBeGreaterThan(window)
    expect(expiry - start / 1000).toBeLessThanOrEqual(2 * window)
    const later = start + 60_000
    expect(signMediaCdnFolder('m/i/abc', 'private', { environment: ENV, now: start })).toBe(
      signMediaCdnFolder('m/i/abc', 'private', { environment: ENV, now: later }),
    )
    const publicExpiry = mediaCdnExpiry('m/i/abc', 'public', start)
    expect(publicExpiry - start / 1000).toBeGreaterThan(MEDIA_CDN_WINDOW_SECONDS.public)
  })

  it('writes the policy CloudFront expects', () => {
    expect(mediaCdnPolicy('https://seanshore.in/m/i/x/*', 1800000000)).toBe(
      '{"Statement":[{"Resource":"https://seanshore.in/m/i/x/*","Condition":{"DateLessThan":{"AWS:EpochTime":1800000000}}}]}',
    )
  })

  it('is off without a key, a key id, an https origin or with an RSA key', () => {
    expect(mediaCdnSigningConfig({})).toBeNull()
    expect(mediaCdnSigningConfig({ ...ENV, MEDIA_CDN_KEY_PAIR_ID: '' })).toBeNull()
    expect(mediaCdnSigningConfig({ ...ENV, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).toBeNull()
    expect(mediaCdnSigningConfig({ ...ENV, MEDIA_CDN_SIGNING_KEY: 'not a key' })).toBeNull()
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(mediaCdnSigningConfig({ ...ENV, MEDIA_CDN_SIGNING_KEY: rsa })).toBeNull()
    expect(signMediaCdnFolder('m/i/abc', 'public', { environment: {} })).toBeNull()
  })
})

describe('CDN keys and URLs', () => {
  it('maps a stored key to one hashed folder', () => {
    const id = mediaCdnId('profiles/p1/avatar-1.webp')
    expect(id).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(imageVariantKey('profiles/p1/avatar-1.webp', 768)).toBe(`m/i/${id}/768.webp`)
    expect(imageVariantKeys('profiles/p1/avatar-1.webp')).toEqual([320, 768, 1600].map((w) => `m/i/${id}/${w}.webp`))
    expect(mediaCdnFileKey('a/b/c.mp4', 'mp4')).toBe(`m/f/${mediaCdnId('a/b/c.mp4')}/file.mp4`)
    expect(mediaCdnId('a')).not.toBe(mediaCdnId('b'))
  })

  it('makes sizes for photos only', () => {
    expect(isImageVariantSource('x/y.jpg')).toBe(true)
    expect(isImageVariantSource('x/y.PNG')).toBe(true)
    expect(isImageVariantSource('x/y.gif')).toBe(false)
    expect(isImageVariantSource('x/y.pdf')).toBe(false)
  })

  it('swaps the width and keeps the one signed query', () => {
    const src = '/m/i/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/768.webp?Policy=p&Signature=s&Key-Pair-Id=K1&Hash-Algorithm=SHA256'
    expect(isCdnImageUrl(src)).toBe(true)
    expect(cdnImageUrlForWidth(src, 96)).toBe(src.replace('/768.', '/320.'))
    expect(cdnImageUrlForWidth(src, 1200)).toBe(src.replace('/768.', '/1600.'))
    expect(cdnImageUrlForWidth(src, 3840)).toBe(src.replace('/768.', '/1600.'))
    expect(cdnImageSrcSet(src)).toBe(
      [320, 768, 1600].map((w) => `${src.replace('/768.', `/${w}.`)} ${w}w`).join(', '),
    )
    expect(imageVariantWidthFor(320)).toBe(320)
    expect(imageVariantWidthFor(321)).toBe(768)
    expect(cdnImageUrlForWidth('/api/feed-media/a', 300)).toBe('/api/feed-media/a')
    expect(cdnImageSrcSet('/api/feed-media/a')).toBeUndefined()
  })
})

describe('media CDN URLs', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('is off by default', () => {
    delete process.env.MEDIA_CDN_SIGNING_KEY
    expect(mediaCdnEnabled()).toBe(false)
    expect(cdnImageSrc('profiles/p/avatar-1.webp')).toBeNull()
    expect(cdnFileUrl('a/b/c.mp4', 'video/mp4')).toBeNull()
  })

  it('signs photos per folder and files under m/f once the key is configured', () => {
    Object.assign(process.env, ENV)
    expect(mediaCdnEnabled()).toBe(true)
    const avatar = cdnImageSrc('profiles/p/avatar-1.webp', 96)!
    expect(avatar).toMatch(new RegExp(`^/m/i/${mediaCdnId('profiles/p/avatar-1.webp')}/320\\.webp\\?Policy=`))
    expect(isCdnImageUrl(avatar)).toBe(true)
    expect(cdnImageSrc('messages/a/b/c.gif')).toBeNull()
    expect(cdnFileUrl('messages/a/b/c.gif', 'image/gif')).toMatch(/^\/m\/f\/[A-Za-z0-9_-]{32}\/file\.gif\?Policy=/)
    expect(cdnFileUrl('a/b/c.pdf', 'application/pdf')).toBeNull()
    expect(cdnMediaUrl('a/b/c.jpg', 'image/jpeg')).toMatch(/\/768\.webp\?/)
    expect(cdnMediaUrl('a/b/c.mp4', 'video/mp4')).toMatch(/\/file\.mp4\?/)
  })

  it('redirects a checked image route to the CDN size only once the CDN is configured', () => {
    delete process.env.MEDIA_CDN_SIGNING_KEY
    expect(cdnImageRedirect('organizations/o/logo-1.png', { width: 320, cacheControl: 'private, max-age=3600' })).toBeNull()
    Object.assign(process.env, ENV)
    const response = cdnImageRedirect('organizations/o/logo-1.png', { width: 320, cacheControl: 'private, max-age=3600' })!
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toMatch(/^\/m\/i\/[A-Za-z0-9_-]{32}\/320\.webp\?Policy=/)
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(cdnImageRedirect('messages/a/b/c.gif', { width: 320, cacheControl: 'x' })).toBeNull()
  })

  it('gives public-facing photos the long window and member content the short one', () => {
    expect(mediaCdnAccessFor('profiles/p/avatar-1.webp')).toBe('public')
    expect(mediaCdnAccessFor('organizations/o/logo-1.png')).toBe('public')
    expect(mediaCdnAccessFor('communities/c/icon-1.webp')).toBe('public')
    expect(mediaCdnAccessFor('events/p/banners/b.jpg')).toBe('public')
    expect(mediaCdnAccessFor('site/about/x.webp')).toBe('public')
    expect(mediaCdnAccessFor('learning/u/c/course_thumbnail/t.jpg')).toBe('public')
    expect(mediaCdnAccessFor('learning/u/c/lesson_image/t.jpg')).toBe('private')
    expect(mediaCdnAccessFor('11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/x.jpg')).toBe('private')
    expect(mediaCdnAccessFor('messages/p/c/x.jpg')).toBe('private')
  })
})

describe('preparing uploads for the CDN', () => {
  const saved = process.env.AWS_MEDIA_BUCKET
  beforeEach(() => {
    process.env.AWS_MEDIA_BUCKET = 'bucket'
    storage.copyMediaObject.mockClear()
    storage.putMediaObject.mockClear()
    storage.getMediaObject.mockReset()
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.AWS_MEDIA_BUCKET
    else process.env.AWS_MEDIA_BUCKET = saved
  })

  async function photo(width: number, height: number) {
    return sharp({ create: { width, height, channels: 3, background: '#336699' } })
      .jpeg()
      .withExif({ IFD0: { Artist: 'Someone', ImageDescription: 'GPS here' } })
      .toBuffer()
  }

  it('renders three WebP sizes without metadata and never enlarges', async () => {
    const variants = await renderImageVariants(await photo(1000, 500))
    expect(variants.map((variant) => variant.width)).toEqual([320, 768, 1600])
    const sizes = await Promise.all(variants.map(async (variant) => sharp(variant.body).metadata()))
    expect(sizes.map((meta) => meta.format)).toEqual(['webp', 'webp', 'webp'])
    expect(sizes.map((meta) => meta.width)).toEqual([320, 768, 1000])
    expect(sizes.every((meta) => meta.exif === undefined)).toBe(true)
  })

  it('writes the sizes with an immutable cache for a photo', async () => {
    const body = await photo(400, 400)
    await prepareMediaForCdn({ key: 'profiles/p/avatar-1.jpg', contentType: 'image/jpeg', body })
    expect(storage.getMediaObject).not.toHaveBeenCalled()
    expect(storage.putMediaObject.mock.calls.map(([call]) => (call as { key: string }).key)).toEqual(imageVariantKeys('profiles/p/avatar-1.jpg'))
    for (const [call] of storage.putMediaObject.mock.calls) {
      expect(call).toMatchObject({ contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' })
    }
  })

  it('reads the stored photo when no bytes are given', async () => {
    storage.getMediaObject.mockResolvedValue({ body: await photo(200, 100), contentType: 'image/jpeg', contentLength: 1 })
    await prepareMediaForCdn({ key: 'a/b/c.jpg', contentType: 'image/jpeg' })
    expect(storage.getMediaObject).toHaveBeenCalledWith({ key: 'a/b/c.jpg', maxBytes: 15 * 1024 * 1024 })
    expect(storage.putMediaObject).toHaveBeenCalledTimes(3)
  })

  it('copies videos and GIFs as they are, and leaves documents alone', async () => {
    await prepareMediaForCdn({ key: 'a/b/c.mp4', contentType: 'video/mp4' })
    await prepareMediaForCdn({ key: 'messages/a/b/c.gif', contentType: 'image/gif' })
    await prepareMediaForCdn({ key: 'a/b/c.pdf', contentType: 'application/pdf' })
    expect(storage.copyMediaObject.mock.calls.map(([call]) => call)).toEqual([
      { sourceKey: 'a/b/c.mp4', destinationKey: mediaCdnFileKey('a/b/c.mp4', 'mp4'), contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' },
      { sourceKey: 'messages/a/b/c.gif', destinationKey: mediaCdnFileKey('messages/a/b/c.gif', 'gif'), contentType: 'image/gif', cacheControl: 'public, max-age=31536000, immutable' },
    ])
    expect(storage.putMediaObject).not.toHaveBeenCalled()
  })

  it('skips a re-checked upload whose CDN copy already exists, and makes a missing one', async () => {
    storage.mediaObjectExists.mockResolvedValueOnce(true)
    await prepareMediaForCdn({ key: 'events/p/banners/b.jpg', contentType: 'image/jpeg', skipIfPresent: true })
    expect(storage.mediaObjectExists).toHaveBeenLastCalledWith(imageVariantKey('events/p/banners/b.jpg', 1600))
    expect(storage.putMediaObject).not.toHaveBeenCalled()

    storage.mediaObjectExists.mockResolvedValueOnce(false)
    storage.getMediaObject.mockResolvedValue({ body: await photo(100, 100), contentType: 'image/jpeg', contentLength: 1 })
    await prepareMediaForCdn({ key: 'events/p/banners/b.jpg', contentType: 'image/jpeg', skipIfPresent: true })
    expect(storage.putMediaObject).toHaveBeenCalledTimes(3)
  })

  it('does nothing where the media bucket is not configured', async () => {
    delete process.env.AWS_MEDIA_BUCKET
    await prepareMediaForCdn({ key: 'a/b/c.mp4', contentType: 'video/mp4' })
    expect(storage.copyMediaObject).not.toHaveBeenCalled()
  })

  it('refuses the upload when a photo cannot be resized', async () => {
    await expect(prepareMediaForCdn({ key: 'a/b/c.jpg', contentType: 'image/jpeg', body: Buffer.from('not an image') })).rejects.toThrow()
  })
})
