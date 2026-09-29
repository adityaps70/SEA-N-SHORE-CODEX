'use client'

import Image, { type ImageProps } from 'next/image'
import { useCallback, useState, type ReactNode } from 'react'
import { isOptimizedMediaImageUrl } from '@/lib/images/media-image-source'

export type MediaImageProps = Omit<
  ImageProps,
  'src' | 'unoptimized' | 'onError' | 'loader' | 'priority' | 'placeholder' | 'blurDataURL' | 'ref'
> & {
  /** A signed storage URL, a first-party /api route, a blob: preview or a data: URL. */
  src: string
  /** Rendered instead of a broken image when the photo cannot be loaded (typically initials). */
  fallback?: ReactNode
}

/**
 * The one image element for member photos and post images.
 *
 * Signed URLs on the media bucket go through Next's image optimizer, so a 44px avatar downloads
 * an ~88px WebP instead of the multi-megabyte original; give it `sizes` (the rendered width) and
 * either `fill` inside a positioned box or `width`/`height`. Any other source (first-party API
 * routes that need the session cookie, blob: previews, data: URLs) is shown unoptimized, exactly
 * like a plain <img>. A photo that fails to load shows `fallback` instead of a broken image.
 */
export function MediaImage({ src, alt, fallback = null, ...props }: MediaImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  // Listen on the element rather than through next/image's `onError` prop: that prop makes
  // next/image re-assign `img.src` after mount, which rewrites the attribute to an absolute URL.
  const watchErrors = useCallback((img: HTMLImageElement | null) => {
    if (!img) return
    const fail = () => setFailedSrc(src)
    // Already failed before this listener existed (for example before hydration).
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
      fail()
      return
    }
    img.addEventListener('error', fail)
    return () => img.removeEventListener('error', fail)
  }, [src])

  if (failedSrc === src) return <>{fallback}</>
  return (
    <Image
      {...props}
      ref={watchErrors}
      src={src}
      alt={alt}
      unoptimized={!isOptimizedMediaImageUrl(src)}
    />
  )
}
