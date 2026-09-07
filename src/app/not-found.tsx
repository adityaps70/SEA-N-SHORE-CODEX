import Link from 'next/link'
import { Anchor, ArrowLeft } from 'lucide-react'
import { Wordmark } from '@/components/brand/wordmark'

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-mist-50 px-4 py-10">
      <section className="w-full max-w-lg rounded-[1.75rem] border border-mist-100 bg-white p-7 text-center shadow-[var(--shadow-card)] sm:p-9">
        <Wordmark />
        <div className="mx-auto mt-8 grid size-14 place-items-center rounded-2xl bg-mist-50 text-ocean-700">
          <Anchor aria-hidden="true" className="size-6" />
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[.16em] text-ocean-700">Page not found</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-navy-950">This route is not on the chart.</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">
          The page may have moved, the link may be outdated, or the content may no longer be available.
        </p>
        <Link href="/home" className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to Home
        </Link>
      </section>
    </main>
  )
}
