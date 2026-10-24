// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOWNSCALE_MAX_EDGE_PX, DOWNSCALE_QUALITY, IMAGE_REENCODE_ERROR_MESSAGE, ImageReencodeError, downscaleImage, imageReencodeErrorMessage } from './downscale-image'

type FakeBitmap = { width: number; height: number; close: () => void }

const state = vi.hoisted(() => ({
  bitmap: null as FakeBitmap | null,
  decodeError: null as Error | null,
  encoded: {} as Partial<Record<string, Blob | null>>,
  drawn: [] as Array<{ width: number; height: number }>,
  encodes: [] as Array<{ type: string; quality: number | undefined }>,
}))

function file(name: string, type: string, bytes: number) {
  return new File([new Uint8Array(bytes)], name, { type, lastModified: 1_700_000_000_000 })
}

function blobOf(bytes: number, type: string) {
  return new Blob([new Uint8Array(bytes)], { type })
}

beforeEach(() => {
  state.bitmap = { width: 4000, height: 3000, close: vi.fn() }
  state.decodeError = null
  state.encoded = { 'image/webp': blobOf(150_000, 'image/webp'), 'image/jpeg': blobOf(220_000, 'image/jpeg') }
  state.drawn = []
  state.encodes = []

  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    if (state.decodeError) throw state.decodeError
    return state.bitmap
  }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return {
      drawImage: (_source: unknown, _x: number, _y: number, width: number, height: number) => {
        state.drawn.push({ width, height })
        // The canvas is sized to the target before drawing.
        expect(this.width).toBe(width)
        expect(this.height).toBe(height)
      },
    } as unknown as CanvasRenderingContext2D
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback, type, quality) {
    state.encodes.push({ type: String(type), quality: typeof quality === 'number' ? quality : undefined })
    callback(state.encoded[String(type)] ?? null)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('downscaleImage', () => {
  it('resizes a large photo to the long edge for its use and encodes it as WebP', async () => {
    const result = await downscaleImage(file('IMG_0001.HEIC.jpg', 'image/jpeg', 4_000_000), 'avatar')

    expect(state.drawn).toEqual([{ width: 800, height: 600 }])
    expect(result.name).toBe('IMG_0001.HEIC.webp')
    expect(result.type).toBe('image/webp')
    expect(result.size).toBe(150_000)
    expect(result.lastModified).toBe(1_700_000_000_000)
    expect(vi.mocked(createImageBitmap)).toHaveBeenCalledWith(expect.any(File), { imageOrientation: 'from-image' })
    expect(state.bitmap?.close).toHaveBeenCalled()
  })

  it.each([
    ['cover', 1920, 1440],
    ['post', 2048, 1536],
    ['message', 2048, 1536],
  ] as const)('caps the long edge of a %s photo at %i px', async (kind, width, height) => {
    await downscaleImage(file('deck.png', 'image/png', 6_000_000), kind)

    expect(DOWNSCALE_MAX_EDGE_PX[kind]).toBe(width)
    expect(state.drawn).toEqual([{ width, height }])
  })

  it.each([
    ['avatar', 0.85],
    ['cover', 0.85],
    ['post', 0.92],
    ['message', 0.92],
  ] as const)('encodes a %s photo as WebP at quality %s so graphics keep their fine text', async (kind, quality) => {
    await downscaleImage(file('poster.png', 'image/png', 6_000_000), kind)

    expect(DOWNSCALE_QUALITY[kind]).toBe(quality)
    expect(state.encodes).toEqual([{ type: 'image/webp', quality }])
  })

  it('uses the same quality for the JPEG fallback', async () => {
    state.encoded = { 'image/webp': blobOf(90_000, 'image/png'), 'image/jpeg': blobOf(220_000, 'image/jpeg') }

    await downscaleImage(file('poster.png', 'image/png', 6_000_000), 'message')

    expect(state.encodes).toEqual([
      { type: 'image/webp', quality: 0.92 },
      { type: 'image/jpeg', quality: 0.92 },
    ])
  })

  it('keeps portrait orientation when scaling', async () => {
    state.bitmap = { width: 1500, height: 3000, close: vi.fn() }

    await downscaleImage(file('tall.jpg', 'image/jpeg', 2_000_000), 'post')

    expect(state.drawn).toEqual([{ width: 1024, height: 2048 }])
  })

  it('re-encodes a small-dimension photo that is still heavy, without enlarging it', async () => {
    state.bitmap = { width: 700, height: 500, close: vi.fn() }

    await downscaleImage(file('heavy.png', 'image/png', 400 * 1024 + 1), 'avatar')

    expect(state.drawn).toEqual([{ width: 700, height: 500 }])
  })

  it('re-encodes even a small photo that already fits, so its EXIF metadata (GPS included) never reaches the server', async () => {
    state.bitmap = { width: 640, height: 480, close: vi.fn() }
    state.encoded = { 'image/webp': blobOf(30_000, 'image/webp'), 'image/jpeg': blobOf(40_000, 'image/jpeg') }
    const original = file('small.jpg', 'image/jpeg', 50_000)

    const result = await downscaleImage(original, 'post')

    expect(result).not.toBe(original)
    expect(result.type).toBe('image/webp')
    expect(state.drawn).toEqual([{ width: 640, height: 480 }])
  })

  it('never touches GIFs or non-images', async () => {
    const gif = file('wave.gif', 'image/gif', 5_000_000)
    const pdf = file('coc.pdf', 'application/pdf', 5_000_000)

    await expect(downscaleImage(gif, 'message')).resolves.toBe(gif)
    await expect(downscaleImage(pdf, 'message')).resolves.toBe(pdf)
    expect(vi.mocked(createImageBitmap)).not.toHaveBeenCalled()
  })

  it('refuses a file the browser cannot decode instead of uploading it with its metadata', async () => {
    state.decodeError = new Error('The source image could not be decoded.')
    const heic = file('IMG_0002.heic', 'image/heic', 3_000_000)

    await expect(downscaleImage(heic, 'avatar')).rejects.toThrow(ImageReencodeError)
    await expect(downscaleImage(heic, 'avatar')).rejects.toThrow(IMAGE_REENCODE_ERROR_MESSAGE)
  })

  it('falls back to JPEG when the browser cannot encode WebP', async () => {
    state.encoded = { 'image/webp': blobOf(90_000, 'image/png'), 'image/jpeg': blobOf(220_000, 'image/jpeg') }

    const result = await downscaleImage(file('deck.jpg', 'image/jpeg', 4_000_000), 'post')

    expect(result.type).toBe('image/jpeg')
    expect(result.name).toBe('deck.jpg')
    expect(result.size).toBe(220_000)
  })

  it('uploads the re-encoded file even when it is bigger than the original, because removing metadata comes first', async () => {
    state.encoded = { 'image/webp': blobOf(500_000, 'image/webp'), 'image/jpeg': blobOf(600_000, 'image/jpeg') }
    const original = file('tiny-but-huge-dimensions.png', 'image/png', 450_000)

    const result = await downscaleImage(original, 'cover')

    expect(result).not.toBe(original)
    expect(result.size).toBe(500_000)
  })

  it('refuses the photo when encoding produces nothing', async () => {
    state.encoded = { 'image/webp': null, 'image/jpeg': null }
    const original = file('deck.jpg', 'image/jpeg', 4_000_000)

    await expect(downscaleImage(original, 'post')).rejects.toThrow(ImageReencodeError)
  })

  it('refuses the photo where the browser has no bitmap decoder at all', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const original = file('deck.jpg', 'image/jpeg', 4_000_000)

    await expect(downscaleImage(original, 'post')).rejects.toThrow(ImageReencodeError)
  })

  it('keeps logo transparency: WebP first, PNG where WebP cannot be encoded, never JPEG', async () => {
    state.encoded = { 'image/webp': blobOf(90_000, 'image/png'), 'image/png': blobOf(80_000, 'image/png') }

    const result = await downscaleImage(file('logo.png', 'image/png', 1_000_000), 'logo')

    expect(state.drawn).toEqual([{ width: 512, height: 384 }])
    expect(state.encodes.map((entry) => entry.type)).toEqual(['image/webp', 'image/png'])
    expect(result.type).toBe('image/png')
    expect(result.name).toBe('logo.png')
  })

  it('keeps certificate artwork in a type the certificate PDF can embed: PNG stays PNG, JPEG stays JPEG', async () => {
    state.encoded = { 'image/png': blobOf(80_000, 'image/png'), 'image/jpeg': blobOf(70_000, 'image/jpeg') }

    const signature = await downscaleImage(file('signature.png', 'image/png', 900_000), 'certificate')
    const photo = await downscaleImage(file('seal.jpg', 'image/jpeg', 900_000), 'certificate')

    expect(signature.type).toBe('image/png')
    expect(photo.type).toBe('image/jpeg')
    expect(state.encodes.map((entry) => entry.type)).toEqual(['image/png', 'image/jpeg'])
    expect(state.drawn).toEqual([{ width: 1200, height: 900 }, { width: 1200, height: 900 }])
  })

  it('gives members the refusal message and keeps other errors private', () => {
    expect(imageReencodeErrorMessage(new ImageReencodeError(), 'Upload failed')).toBe(IMAGE_REENCODE_ERROR_MESSAGE)
    expect(imageReencodeErrorMessage(new Error('s3 503'), 'Upload failed')).toBe('Upload failed')
  })
})
