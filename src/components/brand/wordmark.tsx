import Link from 'next/link'
import { Anchor } from 'lucide-react'

export function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Sea N Shore home"
      className="inline-flex shrink-0 items-center gap-2.5 rounded-lg"
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-navy-950 to-ocean-700 text-white shadow-sm"
      >
        <Anchor className="size-[18px]" strokeWidth={2.4} />
      </span>
      <span className="min-w-0 leading-none">
        <span className="block whitespace-nowrap text-[9px] font-bold uppercase tracking-[.14em] text-ocean-700">
          Global maritime network
        </span>
        <span className="mt-1 block whitespace-nowrap text-base font-extrabold tracking-tight text-navy-950">
          Sea N Shore
        </span>
      </span>
    </Link>
  )
}
