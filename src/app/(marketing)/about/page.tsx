import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'About' }

export default function AboutPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">About Sea N Shore</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-950">A trusted professional home for the global maritime community.</h1>
      <p className="mt-4 text-sm leading-7 text-muted">Sea N Shore connects seafarers, shore professionals, recruiters, trainers, students, families, maritime enthusiasts and organizations through trusted profiles, opportunities, learning, events and community conversations.</p>
      <p className="mt-3 text-sm leading-7 text-muted">The platform is designed to make maritime careers more transparent and useful: fewer unnecessary middle layers, stronger professional identity, and clearer access to people, jobs and knowledge.</p>
    </section>
  )
}
