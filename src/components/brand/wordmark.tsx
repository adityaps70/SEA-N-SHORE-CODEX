import Link from 'next/link'
import { BRAND_ASSETS, BRAND_NAME } from './brand-assets'

type WordmarkProps = {
  compact?: boolean
}

/**
 * The Sea N Shore logo as a link home. `compact` is the horizontal lockup used in headers
 * and footers; the default is the stacked logo used on auth and onboarding cards.
 */
export function Wordmark({ compact = false }: WordmarkProps) {
  const asset = compact ? BRAND_ASSETS.lockup : BRAND_ASSETS.stacked
  return (
    <Link
      href="/"
      aria-label="Sea N Shore home"
      className="inline-flex shrink-0 items-center rounded-lg"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- exact brand artwork at its intrinsic size, no optimizer needed */}
      <img
        src={asset.src}
        width={asset.width}
        height={asset.height}
        alt={BRAND_NAME}
        className={compact ? 'h-11 w-auto max-w-[220px] object-contain sm:max-w-[260px]' : 'h-24 w-auto max-w-full object-contain'}
      />
    </Link>
  )
}
