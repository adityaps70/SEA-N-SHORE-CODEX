'use client'

import { Filter, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { MARITIME_CERTIFICATES, MARITIME_VISAS, SEA_RANKS, SHORE_ROLES, VESSEL_TYPES } from '../catalog'
import type { JobSearchFilters } from '../types'

type JobsDiscoveryControlsProps = {
  filters: JobSearchFilters
  resultCount: number
}

type ActiveFilter = { key: string; label: string }

function replaceValue(params: URLSearchParams, key: string, value: string) {
  params.delete(key)
  if (value) params.set(key, value)
}

export function JobsDiscoveryControls({ filters, resultCount }: JobsDiscoveryControlsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const ranks = filters.mode === 'shore' ? SHORE_ROLES : SEA_RANKS

  const activeFilters: ActiveFilter[] = [
    ...filters.ranks.map((value) => ({ key: 'rank', label: value })),
    ...filters.vesselTypes.map((value) => ({ key: 'vessel', label: value })),
    ...filters.regions.map((value) => ({ key: 'region', label: value })),
    ...filters.certificates.map((value) => ({ key: 'certificate', label: value })),
    ...filters.visas.map((value) => ({ key: 'visa', label: value })),
    ...(filters.minExperienceYears !== null ? [{ key: 'experience', label: `${filters.minExperienceYears}+ years` }] : []),
    ...(filters.joiningWithinDays !== null ? [{ key: 'joining', label: `Join ≤ ${filters.joiningWithinDays} days` }] : []),
    ...(filters.salaryMin !== null ? [{ key: 'salaryMin', label: `Salary ≥ ${filters.salaryMin}` }] : []),
    ...(filters.verifiedOnly ? [{ key: 'verified', label: 'Verified employers' }] : []),
    ...(filters.easyApplyOnly ? [{ key: 'easyApply', label: 'Easy Apply' }] : []),
  ]

  function navigate(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString())
    mutator(params)
    const query = params.toString()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }

  function update(key: string, value: string) {
    navigate((params) => replaceValue(params, key, value))
  }

  function remove(key: string) {
    navigate((params) => params.delete(key))
  }

  function clearAll() {
    navigate((params) => {
      const mode = params.get('mode') ?? filters.mode
      const query = params.get('q') ?? filters.query
      Array.from(params.keys()).forEach((key) => params.delete(key))
      if (mode) params.set('mode', mode)
      if (query) params.set('q', query)
    })
  }

  return (
    <aside className="self-start rounded-[1.5rem] border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] lg:sticky lg:top-20" aria-busy={pending}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 font-semibold text-navy-950"><Filter aria-hidden="true" className="size-4" />Filters</h2>
        <span className="rounded-full bg-mist-50 px-2 py-1 text-xs font-semibold text-teal-700">{activeFilters.length} active filters</span>
      </div>
      <p className="mt-2 text-xs text-muted" aria-live="polite">{resultCount} result{resultCount === 1 ? '' : 's'} now</p>

      {activeFilters.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {activeFilters.map((filter) => (
            <button key={`${filter.key}-${filter.label}`} type="button" onClick={() => remove(filter.key)} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-mist-50 px-2.5 text-xs font-semibold text-navy-950 hover:bg-mist-100" aria-label={`Remove ${filter.label} filter`}>
              {filter.label}<X aria-hidden="true" className="size-3" />
            </button>
          ))}
          <button type="button" onClick={clearAll} className="min-h-8 text-xs font-semibold text-teal-700 hover:underline">Clear all</button>
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        <label className="block text-xs font-semibold text-navy-950">Rank / position
          <select value={filters.ranks[0] ?? ''} onChange={(event) => update('rank', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink">
            <option value="">Any rank</option>{ranks.map((rank) => <option key={rank} value={rank}>{rank}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-navy-950">Vessel type
          <select value={filters.vesselTypes[0] ?? ''} onChange={(event) => update('vessel', event.target.value)} disabled={filters.mode === 'shore'} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink disabled:bg-mist-50">
            <option value="">Any vessel</option>{VESSEL_TYPES.map((vessel) => <option key={vessel} value={vessel}>{vessel}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-navy-950">Region / location
          <input defaultValue={filters.regions[0] ?? ''} onBlur={(event) => update('region', event.currentTarget.value.trim())} placeholder="Any region" className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 px-3 text-sm text-ink" />
        </label>

        <details className="rounded-xl border border-mist-100 p-3" open={activeFilters.some((item) => ['experience', 'joining', 'salaryMin', 'certificate', 'visa', 'verified', 'easyApply'].includes(item.key))}>
          <summary className="cursor-pointer text-sm font-semibold text-navy-950">Advanced filters</summary>
          <div className="mt-3 space-y-4">
            <label className="block text-xs font-semibold text-navy-950">Experience (years)<input type="number" min="0" max="70" step="0.5" defaultValue={filters.minExperienceYears ?? ''} onBlur={(event) => update('experience', event.currentTarget.value)} placeholder="e.g. 4" className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 px-3 text-sm text-ink" /></label>
            <label className="block text-xs font-semibold text-navy-950">Joining within<select value={filters.joiningWithinDays ?? ''} onChange={(event) => update('joining', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink"><option value="">Any date</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option></select></label>
            <label className="block text-xs font-semibold text-navy-950">Minimum salary<input type="number" min="0" defaultValue={filters.salaryMin ?? ''} onBlur={(event) => update('salaryMin', event.currentTarget.value)} placeholder="e.g. 7000" className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 px-3 text-sm text-ink" /></label>
            <label className="block text-xs font-semibold text-navy-950">Certificate<select value={filters.certificates[0] ?? ''} onChange={(event) => update('certificate', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink"><option value="">Any certificate</option>{MARITIME_CERTIFICATES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="block text-xs font-semibold text-navy-950">Visa<select value={filters.visas[0] ?? ''} onChange={(event) => update('visa', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink"><option value="">Any visa</option>{MARITIME_VISAS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={filters.verifiedOnly} onChange={(event) => update('verified', event.target.checked ? '1' : '')} className="size-4 accent-teal-600" />Verified employers</label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={filters.easyApplyOnly} onChange={(event) => update('easyApply', event.target.checked ? '1' : '')} className="size-4 accent-teal-600" />Easy Apply only</label>
          </div>
        </details>

        <label className="block text-xs font-semibold text-navy-950">Sort results
          <select value={filters.sort} onChange={(event) => update('sort', event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink">
            <option value="recommended">Recommended</option><option value="recent">Newest first</option><option value="joining">Joining soonest</option><option value="salary">Highest salary</option>
          </select>
        </label>
      </div>
    </aside>
  )
}
