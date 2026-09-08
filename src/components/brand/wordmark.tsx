import Link from 'next/link'

type WordmarkProps = {
  compact?: boolean
}

export function Wordmark({ compact = false }: WordmarkProps) {
  return (
    <Link
      href="/"
      aria-label="Sea N Shore home"
      className="inline-flex shrink-0 items-center rounded-lg"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- exact uploaded brand artwork is part of the Wordmark contract */}
      <img
        src={compact ? '/brand/sea-and-shore-header-logo.svg' : '/brand/sea-and-shore-master-logo.svg'}
        alt="Sea and Shore Global Shipping Community"
        className={compact ? 'h-11 w-auto max-w-[250px] object-contain sm:max-w-[300px]' : 'h-24 w-auto max-w-full object-contain'}
      />
    </Link>
  )
}
