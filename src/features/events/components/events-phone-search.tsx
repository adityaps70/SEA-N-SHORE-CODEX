'use client'

import { Search, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet } from '@/components/ui/mobile-sheet'

type Option = { value: string; label: string }

const selectClass = 'mt-1.5 min-h-12 w-full cursor-pointer rounded-2xl border border-mist-200 bg-white px-4 text-[15px] font-semibold text-navy-950 outline-none focus:border-teal-500'

/**
 * Phone search for /events (round 8): one search box and a "Filters" chip that opens a sheet
 * with the same selects as the desktop form. The selected values travel as hidden inputs so
 * the sheet can close without losing them; "Show results" submits the same GET query (the
 * sheet renders inside the form).
 */
export function EventsPhoneSearch({
  search,
  category,
  eventType,
  format,
  categories,
  eventTypes,
  formats,
}: {
  search: string
  category?: string
  eventType?: string
  format?: string
  categories: Option[]
  eventTypes: Option[]
  formats: Option[]
}) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState({ category: category ?? '', eventType: eventType ?? '', format: format ?? '' })
  const activeCount = [values.category, values.eventType, values.format].filter(Boolean).length

  function update(key: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  return (
    <form method="get" action="/events" role="search" aria-label="Search events" className="flex items-center gap-2 md:hidden">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search events</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" />
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search events"
          enterKeyHint="search"
          className="min-h-11 w-full rounded-xl border border-transparent bg-mist-100 pl-11 pr-3 text-[15px] text-navy-950 outline-none placeholder:text-muted focus:border-teal-500"
        />
      </label>
      {values.category ? <input type="hidden" name="category" value={values.category} /> : null}
      {values.eventType ? <input type="hidden" name="eventType" value={values.eventType} /> : null}
      {values.format ? <input type="hidden" name="format" value={values.format} /> : null}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 ${activeCount ? 'border-navy-950 bg-navy-950 text-white' : 'border-mist-300 bg-white text-navy-800'}`}
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" />
        Filters
        {activeCount ? <span className="rounded-full bg-white px-1.5 text-xs font-bold text-navy-950"><span className="sr-only">, </span>{activeCount}<span className="sr-only"> selected</span></span> : null}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        portal={false}
        desktop="hidden"
        footer={(
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setValues({ category: '', eventType: '', format: '' })}
              className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full border border-mist-300 px-5 text-[15px] font-semibold text-navy-700 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
            >
              Clear
            </button>
            <button
              type="submit"
              className="inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center rounded-full bg-ocean-700 px-5 text-[15px] font-bold text-white hover:bg-ocean-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
            >
              Show results
            </button>
          </div>
        )}
      >
        <div className="space-y-4 px-3 pb-2 pt-2">
          <label className="block text-sm font-semibold text-navy-950">
            Format
            <select value={values.format} onChange={(event) => update('format', event.target.value)} className={selectClass}>
              <option value="">Any format</option>
              {formats.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-navy-950">
            Category
            <select value={values.category} onChange={(event) => update('category', event.target.value)} className={selectClass}>
              <option value="">All categories</option>
              {categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-navy-950">
            Event type
            <select value={values.eventType} onChange={(event) => update('eventType', event.target.value)} className={selectClass}>
              <option value="">All types</option>
              {eventTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
      </BottomSheet>
    </form>
  )
}
