import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clampPixelCrop, cropImageToFile, cropOutputSize } from './crop-image'

type FakeBitmap = { width: number; height: number; close: () => void }
type Draw = { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }

const state = vi.hoisted(() => ({
  bitmap: null as FakeBitmap | null,
  decodeError: null as Error | null,
  encoded: {} as Partial<Record<string, Blob | null>>,
  drawn: [] as Draw[],
  canvas: [] as Array<{ width: number; height: number }>,
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
  state.canvas = []
  state.encodes = []

  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    if (state.decodeError) throw state.decodeError
    return state.bitmap
  }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return {
      drawImage: (_source: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
        state.canvas.push({ width: this.width, height: this.height })
        state.drawn.push({ sx, sy, sw, sh, dx, dy, dw, dh })
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

describe('cropOutputSize', () => {
  it('keeps a crop that already fits the long edge', () => {
    expect(cropOutputSize({ width: 600, height: 600 }, 1024)).toEqual({ width: 600, height: 600 })
  })

  it('shrinks a large crop so its long edge is the maximum, keeping the aspect', () => {
    expect(cropOutputSize({ width: 3000, height: 750 }, 2048)).toEqual({ width: 2048, height: 512 })
    expect(cropOutputSize({ width: 900, height: 3600 }, 1024)).toEqual({ width: 256, height: 1024 })
  })

  it('never returns an empty edge', () => {
    expect(cropOutputSize({ width: 5000, height: 1 }, 1024)).toEqual({ width: 1024, height: 1 })
  })
})

describe('clampPixelCrop', () => {
  it('rounds to whole pixels and keeps the box inside the image', () => {
    expect(clampPixelCrop({ x: 10.4, y: 20.6, width: 100.2, height: 50.5 }, 4000, 3000)).toEqual({ x: 10, y: 21, width: 100, height: 51 })
    expect(clampPixelCrop({ x: -5, y: -5, width: 100, height: 100 }, 4000, 3000)).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(clampPixelCrop({ x: 3950, y: 2950, width: 100, height: 100 }, 4000, 3000)).toEqual({ x: 3950, y: 2950, width: 50, height: 50 })
  })
})

describe('cropImageToFile', () => {
  it('draws the crop box from the oriented bitmap onto a canvas at the output size and encodes WebP', async () => {
    const result = await cropImageToFile(file('IMG_0001.jpg', 'image/jpeg', 4_000_000), { x: 500, y: 250, width: 2000, height: 2000 }, { maxEdge: 1024 })

    expect(vi.mocked(createImageBitmap)).toHaveBeenCalledWith(expect.any(File), { imageOrientation: 'from-image' })
    expect(state.canvas).toEqual([{ width: 1024, height: 1024 }])
    expect(state.drawn).toEqual([{ sx: 500, sy: 250, sw: 2000, sh: 2000, dx: 0, dy: 0, dw: 1024, dh: 1024 }])
    expect(state.encodes).toEqual([{ type: 'image/webp', quality: 0.92 }])
    expect(result?.name).toBe('IMG_0001.webp')
    expect(result?.type).toBe('image/webp')
    expect(result?.size).toBe(150_000)
    expect(result?.lastModified).toBe(1_700_000_000_000)
    expect(state.bitmap?.close).toHaveBeenCalled()
  })

  it('keeps a small crop at its own size and honours the quality option', async () => {
    await cropImageToFile(file('banner.png', 'image/png', 900_000), { x: 0, y: 1000, width: 3200, height: 800 }, { maxEdge: 2048, quality: 0.8 })

    expect(state.canvas).toEqual([{ width: 2048, height: 512 }])
    expect(state.drawn[0]).toMatchObject({ sx: 0, sy: 1000, sw: 3200, sh: 800, dw: 2048, dh: 512 })
    expect(state.encodes).toEqual([{ type: 'image/webp', quality: 0.8 }])
  })

  it('clamps a crop box that overhangs the image', async () => {
    await cropImageToFile(file('a.jpg', 'image/jpeg', 10), { x: 3500, y: -20, width: 1000, height: 1000 }, { maxEdge: 1024 })

    expect(state.drawn[0]).toMatchObject({ sx: 3500, sy: 0, sw: 500, sh: 1000 })
  })

  it('falls back to JPEG when the browser cannot encode WebP', async () => {
    state.encoded = { 'image/webp': blobOf(90_000, 'image/png'), 'image/jpeg': blobOf(220_000, 'image/jpeg') }

    const result = await cropImageToFile(file('a.png', 'image/png', 10), { x: 0, y: 0, width: 100, height: 100 }, { maxEdge: 1024 })

    expect(state.encodes.map((entry) => entry.type)).toEqual(['image/webp', 'image/jpeg'])
    expect(result?.name).toBe('a.jpg')
    expect(result?.type).toBe('image/jpeg')
  })

  it('resolves to null when the photo cannot be decoded', async () => {
    state.decodeError = new Error('unsupported')

    await expect(cropImageToFile(file('a.heic', 'image/heic', 10), { x: 0, y: 0, width: 10, height: 10 }, { maxEdge: 1024 })).resolves.toBeNull()
    expect(state.drawn).toEqual([])
  })

  it('resolves to null when no encoder answers', async () => {
    state.encoded = {}

    await expect(cropImageToFile(file('a.png', 'image/png', 10), { x: 0, y: 0, width: 10, height: 10 }, { maxEdge: 1024 })).resolves.toBeNull()
    expect(state.bitmap?.close).toHaveBeenCalled()
  })

  it('resolves to null where the browser has no createImageBitmap', async () => {
    vi.stubGlobal('createImageBitmap', undefined)

    await expect(cropImageToFile(file('a.png', 'image/png', 10), { x: 0, y: 0, width: 10, height: 10 }, { maxEdge: 1024 })).resolves.toBeNull()
  })
})
