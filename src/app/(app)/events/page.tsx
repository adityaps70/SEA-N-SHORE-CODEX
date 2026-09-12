import {
  Award,
  CalendarDays,
  Clapperboard,
  Mic2,
  RadioTower,
  Search,
  UsersRound,
} from 'lucide-react'

const eventFormats = [
  {
    title: 'Expert webinars',
    description: 'Live conversations with Master Mariners, Chief Engineers, superintendents, surveyors, lawyers and maritime specialists.',
    meta: 'Online',
    icon: Mic2,
  },
  {
    title: 'Career & hiring sessions',
    description: 'Employer-led sessions, role briefings and career conversations for professionals moving between sea and shore.',
    meta: 'Careers',
    icon: UsersRound,
  },
  {
    title: 'Training & workshops',
    description: 'Practical sessions around safety, vetting, leadership, compliance, technology and professional development.',
    meta: 'Interactive',
    icon: RadioTower,
  },
  {
    title: 'Community meetups',
    description: 'Bring maritime professionals together around trusted relationships, local chapters and shared industry interests.',
    meta: 'Community',
    icon: Award,
  },
] as const

const eventTopics = [
  'SIRE 2.0',
  'Career at sea',
  'Shore opportunities',
  'Leadership',
  'Marine safety',
  'Technology',
  'Mental wellbeing',
  'Maritime law',
] as const

function ComingSoonBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-ocean-100 bg-ocean-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.08em] text-ocean-800">
      Coming soon
    </span>
  )
}

export default function EventsPage() {
  return (
    <main className="space-y-5 py-2 pb-10 sm:py-5">
      <section className="overflow-hidden rounded-[1.75rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
        <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
          <div>
            <div className="flex items-start gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white">
                <CalendarDays aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Sea N Shore Events</p>
                <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950 sm:text-4xl">Maritime events</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">
                  Discover professional conversations, learning sessions and community gatherings built around the maritime world.
                </p>
              </div>
            </div>

            <div
              role="search"
              aria-label="Event search preview"
              className="mt-6 flex min-h-12 max-w-2xl items-center gap-3 rounded-xl border border-mist-100 bg-mist-50 px-4 text-sm text-muted"
            >
              <Search aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">Search events, topics, speakers or organisations</span>
              <span className="hidden sm:inline-flex"><ComingSoonBadge /></span>
            </div>
          </div>

          <div className="rounded-2xl border border-ocean-100 bg-ocean-50/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Professional calendar</p>
            <p className="mt-2 text-lg font-semibold tracking-[-.02em] text-navy-950">One place for what is happening across maritime.</p>
            <p className="mt-2 text-sm leading-6 text-muted">Follow the conversations that matter to your career, company and community.</p>
          </div>
        </div>
      </section>

      <nav aria-label="Events" className="flex gap-2 overflow-x-auto rounded-2xl border border-mist-100 bg-white p-2 shadow-sm">
        <span aria-current="page" className="inline-flex min-h-10 shrink-0 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white">
          Discover
        </span>
        <span className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-navy-900">
          My Events
          <span className="rounded-full bg-mist-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.06em] text-muted">Coming soon</span>
        </span>
        <span className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-navy-900">
          Hosting
          <span className="rounded-full bg-mist-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.06em] text-muted">Coming soon</span>
        </span>
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section aria-labelledby="upcoming-events-heading" className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Discover</p>
                <h2 id="upcoming-events-heading" className="mt-1 text-2xl font-semibold tracking-[-.025em] text-navy-950">Upcoming events</h2>
              </div>
              <ComingSoonBadge />
            </div>

            <div className="mt-5 rounded-2xl border border-dashed border-mist-100 bg-mist-50/60 px-6 py-10 text-center sm:py-12">
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-white text-ocean-700 shadow-sm">
                <CalendarDays aria-hidden="true" className="size-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-navy-950">No published maritime events yet.</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">
                When event publishing launches, upcoming webinars, hiring sessions, workshops, conferences and meetups from verified hosts will appear here.
              </p>
            </div>
          </section>

          <section aria-labelledby="event-formats-heading" className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Browse by format</p>
              <h2 id="event-formats-heading" className="mt-1 text-2xl font-semibold tracking-[-.025em] text-navy-950">Explore event formats</h2>
              <p className="mt-2 text-sm leading-6 text-muted">A maritime-first event directory designed around professional outcomes, not generic listings.</p>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {eventFormats.map((format) => {
                const Icon = format.icon
                return (
                  <article key={format.title} className="group rounded-2xl border border-mist-100 bg-white p-5 transition hover:-translate-y-0.5 hover:border-ocean-100 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div className="grid size-10 place-items-center rounded-xl bg-mist-50 text-ocean-700 group-hover:bg-ocean-50">
                        <Icon aria-hidden="true" className="size-5" />
                      </div>
                      <span className="rounded-full bg-mist-50 px-2.5 py-1 text-[11px] font-semibold text-muted">{format.meta}</span>
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-navy-950">{format.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted">{format.description}</p>
                  </article>
                )
              })}
            </div>
          </section>

          <section aria-labelledby="event-archive-heading" className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="flex items-start gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-950 text-white">
                <Clapperboard aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="event-archive-heading" className="text-xl font-semibold text-navy-950">Event archive</h2>
                  <ComingSoonBadge />
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Past sessions will remain useful through recordings, speaker profiles, event notes and connected learning instead of disappearing after the live event.
                </p>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section aria-labelledby="host-events-heading" className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="grid size-11 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
              <RadioTower aria-hidden="true" className="size-5" />
            </div>
            <h2 id="host-events-heading" className="mt-4 text-xl font-semibold text-navy-950">Host on Sea N Shore</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Verified maritime organisations and approved hosts will be able to publish events, build speaker pages and reach the right professional audience.
            </p>
            <div className="mt-5 border-t border-mist-100 pt-4">
              <ComingSoonBadge />
            </div>
          </section>

          <section aria-labelledby="event-topics-heading" className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Professional interests</p>
            <h2 id="event-topics-heading" className="mt-1 text-lg font-semibold text-navy-950">Popular maritime topics</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {eventTopics.map((topic) => (
                <span key={topic} className="rounded-full border border-mist-100 bg-mist-50 px-3 py-1.5 text-xs font-semibold text-navy-900">
                  {topic}
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-mist-100 bg-navy-950 p-5 text-white shadow-[var(--shadow-card)] sm:p-6">
            <CalendarDays aria-hidden="true" className="size-5 text-ocean-200" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-[.12em] text-ocean-200">Built for maritime</p>
            <p className="mt-2 text-lg font-semibold tracking-[-.02em]">Events connected to careers, learning and community.</p>
            <p className="mt-2 text-sm leading-6 text-white/70">The event layer will connect into the wider Sea N Shore professional ecosystem rather than operate as a separate calendar.</p>
          </section>
        </aside>
      </div>
    </main>
  )
}
