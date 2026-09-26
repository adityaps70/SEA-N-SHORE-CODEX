import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Help' }

export default function HelpPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Help</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-950">Get help with your Sea N Shore account and professional activity.</h1>
      <p className="mt-4 text-sm leading-7 text-muted">For profile, jobs, learning, messaging or account questions, start by checking the relevant page and the guidance shown beside the action. If something is not working, include the page, the action you attempted and any visible error when you contact the Sea N Shore team.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/profile" className="inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white">Review profile</Link>
        <Link href="/jobs" className="inline-flex min-h-10 items-center rounded-xl border border-mist-100 px-4 text-sm font-semibold text-navy-950">Browse jobs</Link>
        <Link href="/learn" className="inline-flex min-h-10 items-center rounded-xl border border-mist-100 px-4 text-sm font-semibold text-navy-950">Open learning</Link>
      </div>
    </section>
  )
}
