'use client'

export default function EventsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
      <div className="rounded-[2rem] border border-rose-100 bg-white p-8 shadow-[var(--shadow-card)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose-600">Events unavailable</p>
        <h1 className="mt-2 text-2xl font-bold text-navy-950">We could not load the maritime events workspace.</h1>
        <p className="mt-2 text-sm text-muted">Your data has not been changed. Retry the request, or return to Events later.</p>
        <button type="button" onClick={reset} className="mt-5 rounded-xl bg-navy-950 px-5 py-3 text-sm font-bold text-white">Try again</button>
      </div>
    </div>
  )
}
