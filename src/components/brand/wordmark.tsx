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
      {compact ? (
        <span className="inline-flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- exact uploaded brand asset path is part of the Wordmark contract */}
          <img
            src="/brand/sea-n-shore-symbol.webp"
            alt=""
            aria-hidden="true"
            className="h-11 w-auto shrink-0 object-contain"
          />
          <span className="flex min-w-0 flex-col leading-none" aria-label="Sea N Shore Global Shipping Community">
            <span className="whitespace-nowrap text-[15px] font-extrabold tracking-[0.12em] text-slate-950 sm:text-base">
              SEA N SHORE
            </span>
            <span className="mt-1 whitespace-nowrap text-[7px] font-semibold uppercase tracking-[0.15em] text-slate-500 sm:text-[8px]">
              Global Shipping Community
            </span>
          </span>
        </span>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- exact uploaded brand asset path is part of the Wordmark contract */}
          <img
            src="/brand/sea-and-shore-master-logo.svg"
            alt="Sea and Shore Global Shipping Community"
            className="h-24 w-auto max-w-full object-contain"
          />
        </>
      )}
    </Link>
  )
}
