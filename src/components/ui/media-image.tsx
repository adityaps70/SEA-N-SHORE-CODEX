'use client'

import Image, { type ImageProps } from 'next/image'
import { useCallback, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { isOptimizedMediaImageUrl } from '@/lib/images/media-image-source'

export type MediaImageProps = Omit<
  ImageProps,
  'src' | 'unoptimized' | 'onError' | 'onLoad' | 'loader' | 'priority' | 'placeholder' | 'blurDataURL' | 'ref'
> & {
  /** A signed storage URL, a first-party /api route, a blob: preview or a data: URL. */
  src: string
  /**
   * Typically the person's or organization's initials. Inside a positioned box (`fill`) it sits
   * underneath the photo until the photo has painted, so the box is never an empty grey shape;
   * if the photo fails to load it is all that remains.
   */
  fallback?: ReactNode
}

/** The photo fades in once painted; users who prefer reduced motion see it appear at once. */
const FADE_IN_CLASS = 'motion-safe:transition-opacity motion-safe:duration-300'

/**
 * The one image element for member photos and post images.
 *
 * Signed URLs on the media bucket go through Next's image optimizer, so a 44px avatar downloads
 * an ~88px WebP instead of the multi-megabyte original; give it `sizes` (the rendered width) and
 * either `fill` inside a positioned box or `width`/`height`. Any other source (first-party API
 * routes that need the session cookie, blob: previews, data: URLs) is shown unoptimized, exactly
 * like a plain <img>. The photo fades in when it has loaded; with `fill`, `fallback` (initials)
 * shows underneath it until then, and a photo that fails to load leaves only `fallback`.
 */
export function MediaImage({ src, alt, fallback = null, className, fill, ...props }: MediaImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)

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

  // next/image also fires onLoad for a photo that finished loading before hydration.
  const image = (
    <Image
      {...props}
      fill={fill}
      ref={watchErrors}
      src={src}
      alt={alt}
      unoptimized={!isOptimizedMediaImageUrl(src)}
      onLoad={() => setLoadedSrc(src)}
      className={cn(className, FADE_IN_CLASS, loadedSrc === src ? 'opacity-100' : 'opacity-0')}
    />
  )

  if (fill && fallback !== null) {
    return (
      <>
        <span aria-hidden="true" className="contents">{fallback}</span>
        {image}
      </>
    )
  }
  return image
}
