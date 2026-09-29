// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

// The shipped app icons are the Sea N Shore "swan" ship mark drawn in pure white on a
// transparent background. The maskable icon is the one exception: maskable icons are cropped
// by the launcher, so it carries the mark on a solid navy (theme colour) safe-zone canvas.

const PUBLIC = path.resolve(__dirname, '../../../public')
const NAVY = [0x07, 0x1b, 0x2d] as const

const TRANSPARENT_ICONS = [
  { file: 'brand/icon-512.png', size: 512 },
  { file: 'brand/icon-192.png', size: 192 },
  { file: 'brand/apple-touch-icon.png', size: 180 },
  { file: 'brand/favicon-32.png', size: 32 },
] as const

type Raw = { data: Buffer; width: number; height: number }

async function decode(input: string | Buffer): Promise<Raw> {
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true })
  expect(info.channels).toBe(4)
  return { data, width: info.width, height: info.height }
}

function pixel({ data, width }: Raw, x: number, y: number) {
  const i = (y * width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const
}

function corners(raw: Raw) {
  const { width: w, height: h } = raw
  return [pixel(raw, 0, 0), pixel(raw, w - 1, 0), pixel(raw, 0, h - 1), pixel(raw, w - 1, h - 1)]
}

/** Every fully opaque pixel, the "most opaque" ink of the icon. */
function opaquePixels({ data }: Raw) {
  const out: Array<readonly [number, number, number]> = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 255) out.push([data[i], data[i + 1], data[i + 2]])
  }
  return out
}

function expectWhiteInk(raw: Raw) {
  const ink = opaquePixels(raw)
  expect(ink.length).toBeGreaterThan(0)
  expect(ink.every(([r, g, b]) => r === 255 && g === 255 && b === 255)).toBe(true)
}

describe('brand icons', () => {
  describe.each(TRANSPARENT_ICONS)('$file', ({ file, size }) => {
    const filePath = path.join(PUBLIC, file)

    it(`is a ${size}x${size} PNG with an alpha channel`, async () => {
      const meta = await sharp(filePath).metadata()
      expect(meta.format).toBe('png')
      expect(meta.width).toBe(size)
      expect(meta.height).toBe(size)
      expect(meta.hasAlpha).toBe(true)
    })

    it('has fully transparent corners', async () => {
      const raw = await decode(filePath)
      for (const [, , , alpha] of corners(raw)) expect(alpha).toBe(0)
    })

    it('draws the mark in pure white', async () => {
      expectWhiteInk(await decode(filePath))
    })
  })

  describe('brand/icon-maskable-512.png', () => {
    const filePath = path.join(PUBLIC, 'brand/icon-maskable-512.png')

    it('is a 512x512 PNG', async () => {
      const meta = await sharp(filePath).metadata()
      expect(meta.format).toBe('png')
      expect(meta.width).toBe(512)
      expect(meta.height).toBe(512)
    })

    it('is opaque navy at the corners (maskable safe-zone background)', async () => {
      const raw = await decode(filePath)
      for (const [r, g, b, a] of corners(raw)) {
        expect(a).toBe(255)
        expect([r, g, b]).toEqual([...NAVY])
      }
    })

    it('has no transparent pixels and keeps the mark inside the safe zone', async () => {
      const raw = await decode(filePath)
      let minX = raw.width, minY = raw.height, maxX = -1, maxY = -1
      for (let y = 0; y < raw.height; y++) {
        for (let x = 0; x < raw.width; x++) {
          const [r, , , a] = pixel(raw, x, y)
          expect(a).toBe(255)
          if (r > 128) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x)
            minY = Math.min(minY, y); maxY = Math.max(maxY, y)
          }
        }
      }
      // The maskable safe zone is the central 80% of the canvas (10% margin on each side).
      const margin = raw.width * 0.1
      expect(minX).toBeGreaterThanOrEqual(margin)
      expect(minY).toBeGreaterThanOrEqual(margin)
      expect(maxX).toBeLessThan(raw.width - margin)
      expect(maxY).toBeLessThan(raw.height - margin)
    })

    it('draws the mark in pure white', async () => {
      const raw = await decode(filePath)
      const ink = opaquePixels(raw).filter(([r, g, b]) => !(r === NAVY[0] && g === NAVY[1] && b === NAVY[2]))
      expect(ink.length).toBeGreaterThan(0)
      // Anti-aliased edges blend white into navy, so the brightest pixels must be pure white.
      const brightest = Math.max(...ink.map(([r]) => r))
      expect(brightest).toBe(255)
      expect(ink.some(([r, g, b]) => r === 255 && g === 255 && b === 255)).toBe(true)
      // And nothing off-hue: every ink pixel sits on the navy -> white line (r <= g <= b).
      expect(ink.every(([r, g, b]) => r <= g && g <= b)).toBe(true)
    })
  })

  describe('favicon.ico', () => {
    const ico = readFileSync(path.join(PUBLIC, 'favicon.ico'))

    it('has a valid ICONDIR header with 3 entries', () => {
      expect(ico.readUInt16LE(0)).toBe(0) // reserved
      expect(ico.readUInt16LE(2)).toBe(1) // type 1 = icon
      expect(ico.readUInt16LE(4)).toBe(3) // image count
    })

    it('contains PNG-encoded 16, 32 and 48 px white-on-transparent frames', async () => {
      const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const sizes: number[] = []
      for (let i = 0; i < 3; i++) {
        const entry = 6 + i * 16
        const width = ico[entry]
        const height = ico[entry + 1]
        expect(ico[entry + 2]).toBe(0) // colour count
        expect(ico[entry + 3]).toBe(0) // reserved
        expect(ico.readUInt16LE(entry + 4)).toBe(1) // planes
        expect(ico.readUInt16LE(entry + 6)).toBe(32) // bits per pixel
        const size = ico.readUInt32LE(entry + 8)
        const offset = ico.readUInt32LE(entry + 12)
        expect(offset + size).toBeLessThanOrEqual(ico.length)

        const blob = ico.subarray(offset, offset + size)
        expect(blob.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)

        const meta = await sharp(blob).metadata()
        expect(meta.format).toBe('png')
        expect(meta.width).toBe(width)
        expect(meta.height).toBe(height)
        expect(meta.hasAlpha).toBe(true)
        sizes.push(width)

        const raw = await decode(blob)
        for (const [, , , alpha] of corners(raw)) expect(alpha).toBe(0)
        expectWhiteInk(raw)
      }
      expect(sizes).toEqual([16, 32, 48])
    })
  })
})
