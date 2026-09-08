import Link from 'next/link'

export function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Sea N Shore home"
      className="inline-flex shrink-0 items-center gap-[11px] rounded-lg"
    >
      <span
        aria-hidden="true"
        className="grid size-[38px] shrink-0 place-items-center rounded-[13px] bg-[linear-gradient(145deg,var(--navy-950),var(--ocean-700))] text-[18px] text-white shadow-[0_8px_22px_rgba(8,44,64,.18)]"
      >
        ⚓
      </span>
      <span className="min-w-0 leading-none">
        <span className="block whitespace-nowrap text-[9px] font-black uppercase tracking-[.14em] text-ocean-700">
          Global maritime network
        </span>
        <span className="mt-1 block whitespace-nowrap text-[17px] font-black tracking-tight text-navy-950">
          Sea N Shore
        </span>
      </span>
    </Link>
  )
}
