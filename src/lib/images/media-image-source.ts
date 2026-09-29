/**
 * Hosts whose photos are served through Next's image optimizer (resized, WebP/AVIF). This list
 * builds `images.remotePatterns` in next.config.ts, so the optimizer only ever fetches from here.
 * Everything else (first-party /api routes, blob: previews, data: URLs) is shown as it is.
 */
export const OPTIMIZED_MEDIA_IMAGE_HOSTNAMES = [
  'sea-n-shore-staging-310356785722-media.s3.ap-south-1.amazonaws.com',
] as const

export function isOptimizedMediaImageUrl(src: string): boolean {
  if (!src.startsWith('https://')) return false
  try {
    const { hostname } = new URL(src)
    return (OPTIMIZED_MEDIA_IMAGE_HOSTNAMES as readonly string[]).includes(hostname)
  } catch {
    return false
  }
}

const VARIANT_MEDIA_QUERY: Record<string, string> = {
  'max-sm': '(max-width: 639px)',
  'max-md': '(max-width: 767px)',
  'max-lg': '(max-width: 1023px)',
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
}

const SIZE_CLASS = /(?:^|\s)(?:(max-sm|max-md|max-lg|sm|md|lg):)?size-(?:(\d+(?:\.\d+)?)|\[(\d+)px\])(?=\s|$)/g

function parseSizeClasses(className: string) {
  const entries: Array<{ variant: string | null; px: number }> = []
  for (const match of className.matchAll(SIZE_CLASS)) {
    const px = match[3] ? Number(match[3]) : Number(match[2]) * 4
    if (Number.isFinite(px) && px > 0) entries.push({ variant: match[1] ?? null, px })
  }
  return entries
}

/**
 * Rendered pixel size of a fixed-size photo box from its Tailwind classes ("size-11" → 44), used
 * for the intrinsic width/height of the image. Responsive variants are ignored; the base wins.
 */
export function avatarPx(className: string, fallbackPx = 48): number {
  const base = parseSizeClasses(className).find((entry) => entry.variant === null)
  return base?.px ?? fallbackPx
}

/**
 * `sizes` attribute for a fixed-size photo box from its Tailwind classes, so the browser fetches
 * a candidate close to the rendered size ("size-11 max-md:size-14" → "(max-width: 767px) 56px, 44px").
 */
export function avatarSizes(className: string, fallbackPx = 48): string {
  const entries = parseSizeClasses(className)
  const base = entries.find((entry) => entry.variant === null)?.px ?? fallbackPx
  const variants = entries
    .filter((entry): entry is { variant: string; px: number } => entry.variant !== null && entry.variant in VARIANT_MEDIA_QUERY)
    .map((entry) => `${VARIANT_MEDIA_QUERY[entry.variant]} ${entry.px}px`)
  return [...variants, `${base}px`].join(', ')
}
