/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'

export function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Sea N Shore home"
      className="inline-flex shrink-0 items-center rounded-lg"
    >
      <img
        src="/brand/sea-and-shore-logo.webp"
        alt="Sea and Shore Global Shipping Community"
        width={180}
        height={160}
        className="h-[58px] w-auto object-contain sm:h-[64px]"
      />
    </Link>
  )
}
