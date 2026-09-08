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
      <img
        src={compact ? '/brand/sea-n-shore-symbol.webp' : '/brand/sea-and-shore-master-logo.svg'}
        alt="Sea and Shore Global Shipping Community"
        className={compact ? 'h-11 w-auto object-contain' : 'h-24 w-auto max-w-full object-contain'}
      />
    </Link>
  )
}
