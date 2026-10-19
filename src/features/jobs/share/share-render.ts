import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import QRCode from 'qrcode'
import sharp from 'sharp'
import { createElement } from 'react'
import type { ShareContent } from './share-content'
import { ShareImage, type ShareImageAssets } from './share-image'
import { layoutShareImage, type ShareLayout } from './share-layout'
import { SHARE_SIZES, type ShareOptions } from './share-options'
import { shareFonts } from './text-fit'

/**
 * Round I (I1): renders the job share image to a PNG with next/og (Satori + resvg), on the server. Logos come from
 * the media store and are turned into small PNGs first (Satori cannot read every format the store holds); the QR
 * code is drawn here too. A finished image is kept in this task's memory by its cache key (the job id, the job's
 * updated_at, the options and the site settings), so the panel's preview and download do not render it twice.
 */
export type LoadMedia = (key: string) => Promise<Uint8Array | null>

const CACHE_LIMIT = 40
const cache = new Map<string, { png: Buffer; layout: ShareLayout }>()

function remember(key: string, value: { png: Buffer; layout: ShareLayout }) {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

async function pngDataUrl(input: Uint8Array | Buffer, resize: { width?: number; height?: number; fit: 'contain' | 'inside' }) {
  const output = await sharp(input, { limitInputPixels: 25_000_000 })
    .resize({ ...resize, background: { r: 255, g: 255, b: 255, alpha: 1 }, withoutEnlargement: false })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer({ resolveWithObject: true })
  return { src: `data:image/png;base64,${output.data.toString('base64')}`, width: output.info.width, height: output.info.height }
}

let brandLogoFile: Promise<Buffer> | null = null
function brandLogo() {
  brandLogoFile ??= readFile(join(process.cwd(), 'public/brand/sea-n-shore-lockup-white.webp'))
  return brandLogoFile
}

async function loadAssets(content: ShareContent, layout: ShareLayout, loadMedia: LoadMedia): Promise<ShareImageAssets> {
  const companyLogo = content.company.logoPath
    ? await loadMedia(content.company.logoPath)
      .then((bytes) => (bytes ? pngDataUrl(bytes, { width: 256, height: 256, fit: 'contain' }).then((image) => image.src) : null))
      .catch(() => null)
    : null

  const brand = await brandLogo()
    .then(async (bytes) => {
      const output = await sharp(bytes).resize({ height: layout.footer.logoHeight * 2 }).png().toBuffer({ resolveWithObject: true })
      const height = layout.footer.logoHeight
      return { src: `data:image/png;base64,${output.data.toString('base64')}`, height, width: Math.round(output.info.width * (height / output.info.height)) }
    })
    .catch(() => null)

  const partnerLogos: ShareImageAssets['partnerLogos'] = []
  if (layout.partners) {
    const displayHeight = Math.round(layout.partners.logoHeight * 0.76)
    for (const partner of content.partners.slice(0, 6)) {
      const bytes = partner.logoPath ? await loadMedia(partner.logoPath).catch(() => null) : null
      if (!bytes) continue
      const image = await pngDataUrl(bytes, { height: displayHeight * 2, fit: 'inside' }).catch(() => null)
      if (!image) continue
      const width = Math.min(layout.partners.logoMaxWidth, Math.round(image.width * (displayHeight / image.height)))
      partnerLogos.push({ name: partner.name, src: image.src, width, height: Math.round(width * (image.height / image.width)) })
    }
  }

  const qr = content.qrUrl && layout.footer.qrSize
    ? await QRCode.toDataURL(content.qrUrl, { margin: 0, width: layout.footer.qrSize * 2, errorCorrectionLevel: 'M', color: { dark: '#071b2dff', light: '#ffffffff' } })
    : null

  return { companyLogo, brandLogo: brand, partnerLogos, qr }
}

export function shareImageCacheKey(input: { jobId: string; updatedAt: string; options: ShareOptions; settingsVersion: string }) {
  const { options } = input
  return [input.jobId, input.updatedAt, options.size, options.look, options.label, options.badge, options.salary, options.qr, options.facts.join('+'), input.settingsVersion].join('|')
}

export async function renderShareImage(input: {
  content: ShareContent
  options: ShareOptions
  loadMedia: LoadMedia
  cacheKey?: string
}): Promise<{ png: Buffer; layout: ShareLayout }> {
  const cached = input.cacheKey ? cache.get(input.cacheKey) : undefined
  if (cached) return cached
  const layout = layoutShareImage(input.content, input.options.size)
  const assets = await loadAssets(input.content, layout, input.loadMedia)
  const { width, height } = SHARE_SIZES[input.options.size]
  const response = new ImageResponse(
    createElement(ShareImage, { content: input.content, layout, look: input.options.look, badge: input.options.badge, assets }),
    { width, height, fonts: shareFonts().satori },
  )
  const png = Buffer.from(await response.arrayBuffer())
  const result = { png, layout }
  if (input.cacheKey) remember(input.cacheKey, result)
  return result
}

/** PNG width and height from its IHDR chunk. */
export function pngSize(png: Uint8Array) {
  const view = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) }
}
