import { BellRing } from 'lucide-react'
import { DeleteJobAlertButton, JobAlertForm } from '@/features/jobs/components/job-alert-form'
import { JobsSubnav } from '@/features/jobs/components/jobs-subnav'
import { getJobAlerts } from '@/features/jobs/queries'

type RawParams = Record<string, string | string[] | undefined>

function serialize(params: RawParams) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item))
    else if (value) query.set(key, value)
  })
  return query.toString() || 'mode=for-you'
}

function describeFilters(filters: { mode: string; ranks: string[]; vesselTypes: string[]; regions: string[]; query: string }) {
  return [filters.mode === 'for-you' ? 'For You' : filters.mode, filters.ranks[0], filters.vesselTypes[0], filters.regions[0], filters.query].filter(Boolean).join(' · ')
}

export default async function JobAlertsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const rawParams = await searchParams
  const alerts = await getJobAlerts()
  const queryString = serialize(rawParams)

  return (
    <section className="py-2 sm:py-5">
      <div className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8"><div className="flex items-start gap-4"><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white"><BellRing aria-hidden="true" className="size-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Jobs workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950">Job Alerts</h1><p className="mt-2 max-w-2xl text-sm leading-7 text-muted">Turn a maritime search into an alert so relevant openings can be surfaced without repeating the same filters every day.</p></div></div></div>
      <JobsSubnav active="alerts" />
      <div className="mt-5"><JobAlertForm queryString={queryString} /></div>

      <div className="mt-7"><div className="mb-3"><p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Saved searches</p><h2 className="mt-1 text-xl font-semibold text-navy-950">Your alerts</h2></div>
        {alerts.length ? <div className="grid gap-3 lg:grid-cols-2">{alerts.map((alert) => <article key={alert.id} className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-navy-950">{alert.name}</h3><p className="mt-1 text-sm leading-6 text-muted">{describeFilters(alert.filters)}</p></div><span className={alert.enabled ? 'rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800' : 'rounded-full bg-mist-50 px-2.5 py-1 text-xs font-semibold text-muted'}>{alert.enabled ? 'Active' : 'Paused'}</span></div><div className="mt-4 flex items-center justify-between border-t border-mist-100 pt-3"><p className="text-xs font-semibold uppercase tracking-wider text-muted">{alert.frequency} delivery</p><DeleteJobAlertButton alertId={alert.id} /></div></article>)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-10 text-center"><p className="font-semibold text-navy-950">No alerts created yet.</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Start with For You or open Jobs discovery, apply your filters, then create an alert from that search.</p></div>}
      </div>
    </section>
  )
}
