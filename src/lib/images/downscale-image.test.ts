import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOWNSCALE_MAX_EDGE_PX, DOWNSCALE_QUALITY, DOWNSCALE_SKIP_BYTES, downscaleImage } from './downscale-image'

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

    await downscaleImage(file('heavy.png', 'image/png', DOWNSCALE_SKIP_BYTES + 1), 'avatar')

    expect(state.drawn).toEqual([{ width: 700, height: 500 }])
  })

  it('skips photos that already fit and are at most 400 KB', async () => {
    state.bitmap = { width: 640, height: 480, close: vi.fn() }
    const original = file('small.jpg', 'image/jpeg', DOWNSCALE_SKIP_BYTES)

    await expect(downscaleImage(original, 'post')).resolves.toBe(original)
    expect(state.drawn).toEqual([])
  })

  it('never touches GIFs or non-images', async () => {
    const gif = file('wave.gif', 'image/gif', 5_000_000)
    const pdf = file('coc.pdf', 'application/pdf', 5_000_000)

    await expect(downscaleImage(gif, 'message')).resolves.toBe(gif)
    await expect(downscaleImage(pdf, 'message')).resolves.toBe(pdf)
    expect(vi.mocked(createImageBitmap)).not.toHaveBeenCalled()
  })

  it('uploads the original when the browser cannot decode the file', async () => {
    state.decodeError = new Error('The source image could not be decoded.')
    const heic = file('IMG_0002.heic', 'image/heic', 3_000_000)

    await expect(downscaleImage(heic, 'avatar')).resolves.toBe(heic)
  })

  it('falls back to JPEG when the browser cannot encode WebP', async () => {
    state.encoded = { 'image/webp': blobOf(90_000, 'image/png'), 'image/jpeg': blobOf(220_000, 'image/jpeg') }

    const result = await downscaleImage(file('deck.jpg', 'image/jpeg', 4_000_000), 'post')

    expect(result.type).toBe('image/jpeg')
    expect(result.name).toBe('deck.jpg')
    expect(result.size).toBe(220_000)
  })

  it('never returns a file bigger than the original', async () => {
    state.encoded = { 'image/webp': blobOf(500_000, 'image/webp'), 'image/jpeg': blobOf(600_000, 'image/jpeg') }
    const original = file('tiny-but-huge-dimensions.png', 'image/png', 450_000)

    await expect(downscaleImage(original, 'cover')).resolves.toBe(original)
  })

  it('uploads the original when encoding produces nothing', async () => {
    state.encoded = { 'image/webp': null, 'image/jpeg': null }
    const original = file('deck.jpg', 'image/jpeg', 4_000_000)

    await expect(downscaleImage(original, 'post')).resolves.toBe(original)
  })

  it('uploads the original where the browser has no bitmap decoder at all', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const original = file('deck.jpg', 'image/jpeg', 4_000_000)

    await expect(downscaleImage(original, 'post')).resolves.toBe(original)
  })
})
