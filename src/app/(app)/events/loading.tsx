export default function EventsLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading events">
      <div className="h-48 animate-pulse rounded-[2rem] bg-navy-100" />
      <div className="h-16 animate-pulse rounded-2xl bg-mist-100" />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-80 animate-pulse rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]" />)}</div>
    </div>
  )
}
