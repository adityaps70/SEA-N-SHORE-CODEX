'use client'

import Link from 'next/link'
import { MapPin, Search, SlidersHorizontal, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'
import { BottomSheet } from '@/components/ui/mobile-sheet'
import { JOB_DISCOVERY_MODES, MARITIME_CERTIFICATES, MARITIME_VISAS, VESSEL_TYPES } from '../catalog'
import { jobDepartments, roleByKey, rolesFor } from '@/features/roles/taxonomy'
import { JOB_JOINING_WINDOWS, JOB_SORT_OPTIONS, activeJobFilters } from '../filter-state'
import type { JobSearchFilters } from '../types'
import { CHIP_ROW_CLASS, PHONE_OUTLINE_BUTTON, PHONE_PRIMARY_BUTTON, chipClass } from './mobile-chip'
import { SheetPortal } from './sheet-portal'

type JobsMobileToolbarProps = {
  filters: JobSearchFilters
  resultCount: number
}

const COLLAPSED_CHIP_COUNT = 6
const FIELD_CLASS = 'mt-2 min-h-11 w-full rounded-xl border border-mist-300 bg-white px-3 text-[15px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'

function FilterSection({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="border-b border-mist-100 px-3 py-4 last:border-b-0">
      <h3 id={id} className="text-[15px] font-bold text-navy-950">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function ChipChoices({
  options,
  selected,
  onSelect,
  collapsible = false,
  disabled = false,
  label,
}: {
  options: readonly string[]
  selected: string | null
  onSelect(value: string | null): void
  collapsible?: boolean
  disabled?: boolean
  label: string
}) {
  const [expanded, setExpanded] = useState(false)
  const collapsed = collapsible && !expanded && options.length > COLLAPSED_CHIP_COUNT
  const visible = collapsed
    ? [...options.slice(0, COLLAPSED_CHIP_COUNT), ...(selected && options.indexOf(selected) >= COLLAPSED_CHIP_COUNT ? [selected] : [])]
    : options
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2 py-1">
      {visible.map((option) => {
        const active = selected === option
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onSelect(active ? null : option)}
            className={chipClass(active)}
          >
            {option}
          </button>
        )
      })}
      {collapsed ? (
        <button type="button" onClick={() => setExpanded(true)} className={chipClass(false)}>
          + {options.length - COLLAPSED_CHIP_COUNT} more
        </button>
      ) : null}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(next: boolean): void }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 text-[15px] font-semibold text-navy-950">
      {label}
      <span className="relative inline-flex">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span aria-hidden="true" className="h-7 w-12 rounded-full bg-mist-300 transition peer-checked:bg-ocean-700 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ocean-500" />
        <span aria-hidden="true" className="absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  )
}

/**
 * Phone jobs toolbar (round 8, below md only): compact search, one scrolling chip row with the
 * discovery modes and "All filters", the active-filter chips, and the full-screen filter sheet that
 * holds every filter from the desktop panel. Filters apply as they change, like the desktop panel.
 */
export function JobsMobileToolbar({ filters, resultCount }: JobsMobileToolbarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [sheetOpen, setSheetOpen] = useState(false)
  const activeFilters = activeJobFilters(filters)
  // Round 12: the same Department → Rank lists as profiles and the job form.
  const departments = jobDepartments().filter((department) =>
    filters.mode === 'sea' || filters.mode === 'shore' ? department.domain === filters.mode : true)
  // An older link with only a rank shows that rank's department.
  const selectedDepartment = filters.department ?? roleByKey(filters.ranks[0])?.department ?? ''
  const ranks = rolesFor(selectedDepartment).filter((role) => !role.other)

  function navigate(mutator: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString())
    mutator(params)
    const query = params.toString()
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }))
  }

  function update(key: string, value: string | null) {
    navigate((params) => {
      params.delete(key)
      if (value) params.set(key, value)
    })
  }

  function reset() {
    navigate((params) => {
      const mode = params.get('mode') ?? filters.mode
      const query = params.get('q') ?? filters.query
      Array.from(params.keys()).forEach((key) => params.delete(key))
      if (mode) params.set('mode', mode)
      if (query) params.set('q', query)
    })
  }

  const showLabel = pending
    ? 'Updating results…'
    : `Show ${resultCount} result${resultCount === 1 ? '' : 's'}`

  return (
    <div className="md:hidden" aria-busy={pending}>
      <form action="/jobs" method="get" role="search" aria-label="Search jobs" className="grid grid-cols-2 gap-2">
        <input type="hidden" name="mode" value={filters.mode} />
        <input type="hidden" name="sort" value={filters.sort} />
        <label className="relative block">
          <span className="sr-only">Role, rank or company</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-900" />
          <input
            name="q"
            type="search"
            enterKeyHint="search"
            defaultValue={filters.query}
            maxLength={120}
            placeholder="Role or company"
            className="min-h-11 w-full rounded-xl bg-mist-50 py-2 pl-9 pr-2 text-[15px] text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
          />
        </label>
        <label className="relative block">
          <span className="sr-only">Location</span>
          <MapPin aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-900" />
          <input
            name="region"
            type="search"
            enterKeyHint="search"
            defaultValue={filters.regions[0] ?? ''}
            maxLength={120}
            placeholder="Anywhere"
            className="min-h-11 w-full rounded-xl bg-mist-50 py-2 pl-9 pr-2 text-[15px] text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
          />
        </label>
        <button type="submit" className="sr-only">Search jobs</button>
      </form>

      <nav aria-label="Job views" className={`${CHIP_ROW_CLASS} mt-1`}>
        <Link href="/jobs/applications" className={chipClass(false)}>My jobs</Link>
        {JOB_DISCOVERY_MODES.map((mode) => (
          <Link
            key={mode.value}
            href={`/jobs?mode=${mode.value}`}
            aria-current={filters.mode === mode.value ? 'page' : undefined}
            className={chipClass(filters.mode === mode.value)}
          >
            {mode.label}
          </Link>
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
          className={chipClass(activeFilters.length > 0)}
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          All filters{activeFilters.length ? ` (${activeFilters.length})` : ''}
        </button>
      </nav>

      {activeFilters.length ? (
        <div className={CHIP_ROW_CLASS} role="group" aria-label="Active filters">
          {activeFilters.map((filter) => (
            <button
              key={`${filter.key}-${filter.label}`}
              type="button"
              onClick={() => update(filter.key, null)}
              aria-label={`Remove ${filter.label} filter`}
              className="relative inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-ocean-50 px-3 text-[13px] font-semibold text-ocean-800 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-ocean-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
            >
              {filter.label}
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ))}
          <button type="button" onClick={reset} className="relative min-h-8 shrink-0 cursor-pointer px-2 text-[13px] font-semibold text-ocean-700 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:underline">
            Clear all
          </button>
        </div>
      ) : null}

      <SheetPortal>
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="All filters"
        desktop="hidden"
        fullHeight
        footer={(
          <div className="flex gap-2">
            <button type="button" onClick={reset} disabled={pending || activeFilters.length === 0} className={`${PHONE_OUTLINE_BUTTON} shrink-0`}>
              Reset
            </button>
            <button type="button" onClick={() => setSheetOpen(false)} className={`${PHONE_PRIMARY_BUTTON} flex-1`} aria-live="polite">
              {showLabel}
            </button>
          </div>
        )}
      >
        <div data-testid="job-filters-sheet">
          <FilterSection title="Sort by" id="job-filter-sort">
            <div role="group" aria-label="Sort results" className="flex flex-wrap gap-2 py-1">
              {JOB_SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filters.sort === option.value}
                  onClick={() => update('sort', option.value === 'recommended' ? null : option.value)}
                  className={chipClass(filters.sort === option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </FilterSection>

          <FilterSection title={filters.mode === 'shore' ? 'Department and role' : 'Department and rank'} id="job-filter-rank">
            <label className="block text-[13px] font-semibold text-navy-900">Department
              <select
                value={selectedDepartment}
                onChange={(event) => navigate((params) => {
                  params.delete('department')
                  params.delete('rank')
                  if (event.target.value) params.set('department', event.target.value)
                })}
                className={FIELD_CLASS}
              >
                <option value="">Any department</option>
                {departments.map((department) => <option key={department.key} value={department.key}>{department.label}</option>)}
              </select>
            </label>
            <label className="mt-3 block text-[13px] font-semibold text-navy-900">Rank / position
              <select value={filters.ranks[0] ?? ''} onChange={(event) => update('rank', event.target.value || null)} disabled={!selectedDepartment} className={`${FIELD_CLASS} disabled:bg-mist-50`}>
                <option value="">{selectedDepartment ? 'Any rank' : 'Choose a department first'}</option>
                {ranks.map((rank) => <option key={rank.key} value={rank.key}>{rank.label}</option>)}
              </select>
            </label>
          </FilterSection>

          <FilterSection title="Vessel type" id="job-filter-vessel">
            {filters.mode === 'shore' ? <p className="text-[13px] text-muted">Vessel type does not apply to shore jobs.</p> : null}
            <ChipChoices label="Vessel type" options={VESSEL_TYPES} selected={filters.vesselTypes[0] ?? null} onSelect={(value) => update('vessel', value)} collapsible disabled={filters.mode === 'shore'} />
          </FilterSection>

          <FilterSection title="Joining within" id="job-filter-joining">
            <div role="group" aria-label="Joining within" className="flex flex-wrap gap-2 py-1">
              <button type="button" aria-pressed={filters.joiningWithinDays === null} onClick={() => update('joining', null)} className={chipClass(filters.joiningWithinDays === null)}>Any date</button>
              {JOB_JOINING_WINDOWS.map((days) => (
                <button key={days} type="button" aria-pressed={filters.joiningWithinDays === days} onClick={() => update('joining', String(days))} className={chipClass(filters.joiningWithinDays === days)}>
                  {days} days
                </button>
              ))}
            </div>
          </FilterSection>

          <FilterSection title="Experience and salary" id="job-filter-numbers">
            <label className="block text-[13px] font-semibold text-navy-900">Experience (years)
              <input key={`experience-${filters.minExperienceYears ?? ''}`} type="number" inputMode="decimal" min="0" max="70" step="0.5" defaultValue={filters.minExperienceYears ?? ''} onBlur={(event) => update('experience', event.currentTarget.value || null)} placeholder="e.g. 4" className={FIELD_CLASS} />
            </label>
            <label className="mt-3 block text-[13px] font-semibold text-navy-900">Minimum salary
              <input key={`salary-${filters.salaryMin ?? ''}`} type="number" inputMode="numeric" min="0" defaultValue={filters.salaryMin ?? ''} onBlur={(event) => update('salaryMin', event.currentTarget.value || null)} placeholder="e.g. 7000" className={FIELD_CLASS} />
            </label>
          </FilterSection>

          <FilterSection title="Certificates and visas" id="job-filter-credentials">
            <label className="block text-[13px] font-semibold text-navy-900">Certificate
              <select value={filters.certificates[0] ?? ''} onChange={(event) => update('certificate', event.target.value || null)} className={FIELD_CLASS}>
                <option value="">Any certificate</option>
                {MARITIME_CERTIFICATES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="mt-3 block text-[13px] font-semibold text-navy-900">Visa
              <select value={filters.visas[0] ?? ''} onChange={(event) => update('visa', event.target.value || null)} className={FIELD_CLASS}>
                <option value="">Any visa</option>
                {MARITIME_VISAS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </FilterSection>

          <FilterSection title="Employer and apply" id="job-filter-flags">
            <Toggle label="Verified employers" checked={filters.verifiedOnly} onChange={(next) => update('verified', next ? '1' : null)} />
            <Toggle label="Easy Apply only" checked={filters.easyApplyOnly} onChange={(next) => update('easyApply', next ? '1' : null)} />
          </FilterSection>
        </div>
      </BottomSheet>
      </SheetPortal>
    </div>
  )
}
