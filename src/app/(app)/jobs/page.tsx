import Link from 'next/link'
import { BellRing, BriefcaseBusiness, Filter, Search, ShieldCheck, Sparkles } from 'lucide-react'
import { JobCard } from '@/features/jobs/components/job-card'
import { JobsSubnav } from '@/features/jobs/components/jobs-subnav'
import { JOB_DISCOVERY_MODES, MARITIME_CERTIFICATES, MARITIME_VISAS, SEA_RANKS, SHORE_ROLES, VESSEL_TYPES } from '@/features/jobs/catalog'
import { getJobsDiscovery } from '@/features/jobs/queries'

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function serialize(params: RawParams) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item))
    else if (value) query.set(key, value)
  })
  return query.toString()
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const rawParams = await searchParams
  const discovery = await getJobsDiscovery(rawParams)
  const { filters, items, profileReady } = discovery
  const ranks = filters.mode === 'shore' ? SHORE_ROLES : SEA_RANKS
  const alertQuery = serialize(rawParams) || 'mode=for-you'
  const activeFilterCount = [filters.ranks.length, filters.vesselTypes.length, filters.regions.length, filters.certificates.length, filters.visas.length, filters.minExperienceYears !== null ? 1 : 0, filters.joiningWithinDays !== null ? 1 : 0, filters.salaryMin !== null ? 1 : 0, filters.verifiedOnly ? 1 : 0, filters.urgentOnly ? 1 : 0].reduce((sum, value) => sum + value, 0)

  return (
    <section className="py-2 sm:py-5">
      <div className="overflow-hidden rounded-[1.75rem] border border-mist-100 bg-navy-950 p-5 text-white shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-white/70"><Sparkles aria-hidden="true" className="size-4" />Sea N Shore Jobs Intelligence</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">The right maritime role should find you faster.</h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-white/70">Search sea and shore opportunities using real maritime requirements, then see why each role matches your rank, experience, vessels and credentials.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80"><ShieldCheck aria-hidden="true" className="mr-2 inline size-4" />Verified employer signals and suspicious-job reporting are built in.</div>
        </div>

        <form action="/jobs" method="get" role="search" className="mt-6 grid gap-2 rounded-2xl bg-white p-2 sm:grid-cols-[1fr_180px_auto]">
          <input type="hidden" name="mode" value={filters.mode} />
          <label className="relative block">
            <span className="sr-only">Search maritime jobs</span><Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input name="q" type="search" defaultValue={filters.query} maxLength={120} placeholder="Position, rank, company or keyword" className="min-h-12 w-full rounded-xl bg-mist-50 py-3 pl-10 pr-3 text-sm text-ink outline-none focus:ring-2 focus:ring-ocean-700/30" />
          </label>
          <input name="region" defaultValue={filters.regions[0] ?? ''} placeholder="Region / location" className="min-h-12 rounded-xl bg-mist-50 px-3 text-sm text-ink outline-none focus:ring-2 focus:ring-ocean-700/30" />
          <button type="submit" className="min-h-12 rounded-xl bg-ocean-700 px-6 text-sm font-semibold text-white hover:bg-ocean-800">Search jobs</button>
        </form>
      </div>

      <JobsSubnav active="discover" />

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {JOB_DISCOVERY_MODES.map((mode) => <Link key={mode.value} href={`/jobs?mode=${mode.value}`} className={filters.mode === mode.value ? 'shrink-0 rounded-full bg-navy-950 px-4 py-2 text-sm font-semibold text-white' : 'shrink-0 rounded-full border border-mist-100 bg-white px-4 py-2 text-sm font-semibold text-navy-950 hover:bg-mist-50'}>{mode.label}</Link>)}
      </div>

      {!profileReady ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><strong>Complete your Maritime Passport for smarter recommendations.</strong> Your job search still works, but match scores become useful once rank, vessel experience and credentials are available. <Link href="/profile" className="font-semibold underline">Complete profile</Link></div> : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="self-start rounded-[1.5rem] border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] lg:sticky lg:top-20">
          <div className="flex items-center justify-between"><h2 className="inline-flex items-center gap-2 font-semibold text-navy-950"><Filter aria-hidden="true" className="size-4" />Filters</h2>{activeFilterCount ? <span className="rounded-full bg-mist-50 px-2 py-1 text-xs font-semibold text-ocean-700">{activeFilterCount} active</span> : null}</div>
          <form action="/jobs" method="get" className="mt-4 space-y-4">
            <input type="hidden" name="mode" value={filters.mode} /><input type="hidden" name="q" value={filters.query} />
            <label className="block text-xs font-semibold text-navy-950">Rank / position<select name="rank" defaultValue={filters.ranks[0] ?? ''} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink"><option value="">Any rank</option>{ranks.map((rank) => <option key={rank} value={rank}>{rank}</option>)}</select></label>
            <label className="block text-xs font-semibold text-navy-950">Vessel type<select name="vessel" defaultValue={filters.vesselTypes[0] ?? ''} disabled={filters.mode === 'shore'} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink disabled:bg-mist-50"><option value="">Any vessel</option>{VESSEL_TYPES.map((vessel) => <option key={vessel} value={vessel}>{vessel}</option>)}</select></label>
            <label className="block text-xs font-semibold text-navy-950">Experience (years)<input name="experience" type="number" min="0" max="70" step="0.5" defaultValue={filters.minExperienceYears ?? ''} placeholder="e.g. 4" className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 px-3 text-sm text-ink" /></label>
            <label className="block text-xs font-semibold text-navy-950">Joining within<select name="joining" defaultValue={filters.joiningWithinDays ?? ''} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink"><option value="">Any date</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option></select></label>
            <label className="block text-xs font-semibold text-navy-950">Minimum salary<input name="salaryMin" type="number" min="0" defaultValue={filters.salaryMin ?? ''} placeholder="e.g. 7000" className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 px-3 text-sm text-ink" /></label>
            <label className="block text-xs font-semibold text-navy-950">Certificate<select name="certificate" defaultValue={filters.certificates[0] ?? ''} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink"><option value="">Any certificate</option>{MARITIME_CERTIFICATES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="block text-xs font-semibold text-navy-950">Visa<select name="visa" defaultValue={filters.visas[0] ?? ''} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink"><option value="">Any visa</option>{MARITIME_VISAS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink"><input name="verified" value="1" type="checkbox" defaultChecked={filters.verifiedOnly} className="size-4 accent-navy-950" />Verified employers</label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink"><input name="easyApply" value="1" type="checkbox" defaultChecked={filters.easyApplyOnly} className="size-4 accent-navy-950" />Easy Apply only</label>
            <div className="grid grid-cols-2 gap-2"><button type="submit" className="min-h-10 rounded-xl bg-navy-950 px-3 text-sm font-semibold text-white">Apply filters</button><Link href={`/jobs?mode=${filters.mode}`} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-mist-100 text-sm font-semibold text-navy-950">Reset</Link></div>
          </form>
        </aside>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm font-semibold text-navy-950">{items.length} matching opportunit{items.length === 1 ? 'y' : 'ies'}</p><p className="mt-0.5 text-xs text-muted">Recommended order uses your maritime profile when available.</p></div>
            <div className="flex items-center gap-2"><Link href={`/jobs/alerts?${alertQuery}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950 hover:bg-mist-50"><BellRing aria-hidden="true" className="size-4" />Create alert</Link></div>
          </div>
          {items.length ? <div className="grid gap-4 xl:grid-cols-2">{items.map(({ job, match, isSaved }) => <JobCard key={job.id} job={job} match={match} isSaved={isSaved} />)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-12 text-center"><BriefcaseBusiness aria-hidden="true" className="mx-auto size-6 text-muted" /><p className="mt-3 font-semibold text-navy-950">No roles match these filters yet.</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Try widening the rank, vessel, joining-date or salary requirements—or create an alert for this search.</p></div>}
        </div>
      </div>
    </section>
  )
}
