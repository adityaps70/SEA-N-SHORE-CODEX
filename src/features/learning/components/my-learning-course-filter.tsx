'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Learning round E (E7): My Learning's course list with filter chips. The cards are rendered on the server and
 * arrive already sorted by last activity. Archived courses (the trainer archived or removed them) never mix with
 * the rest: under "All" they sit in a collapsed group at the end.
 */

export type MyLearningCourseGroup = 'in_progress' | 'completed' | 'archived'
export type MyLearningCourseItem = { id: string; group: MyLearningCourseGroup; card: ReactNode }
type Filter = 'all' | MyLearningCourseGroup

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' },
]

const GRID = 'grid gap-5 max-md:gap-3 md:grid-cols-2 xl:grid-cols-3'

export function MyLearningCourseFilter({ items }: { items: MyLearningCourseItem[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const counts: Record<Filter, number> = {
    all: items.length,
    in_progress: items.filter((item) => item.group === 'in_progress').length,
    completed: items.filter((item) => item.group === 'completed').length,
    archived: items.filter((item) => item.group === 'archived').length,
  }
  const visible = filter === 'all' ? items.filter((item) => item.group !== 'archived') : items.filter((item) => item.group === filter)
  const archived = items.filter((item) => item.group === 'archived')

  return (
    <div className="mt-6 max-md:mt-0">
      <div role="group" aria-label="Show courses" className="flex flex-wrap gap-2 max-md:px-4 max-md:pt-3">
        {FILTERS.filter((option) => option.id !== 'archived' || counts.archived > 0).map((option) => {
          const selected = option.id === filter
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilter(option.id)}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${selected ? 'border-navy-950 bg-navy-950 text-white' : 'border-mist-200 bg-white text-navy-900 hover:bg-mist-50'}`}
            >
              {option.label}
              <span className={`rounded-full px-2 text-xs font-bold ${selected ? 'bg-white/20 text-white' : 'bg-mist-100 text-navy-800'}`}>{counts[option.id]}</span>
            </button>
          )
        })}
      </div>

      <section aria-label="Your courses" className="mt-4 max-md:px-4">
        {visible.length ? (
          <div className={GRID}>{visible.map((item) => <div key={item.id} className="contents">{item.card}</div>)}</div>
        ) : (
          <p className="rounded-2xl border border-dashed border-mist-200 bg-white p-6 text-center text-sm text-muted">
            {filter === 'completed' ? 'No completed courses yet.' : filter === 'in_progress' ? 'Nothing in progress right now.' : 'No courses here.'}
          </p>
        )}
      </section>

      {filter === 'all' && archived.length ? (
        <details className="group mt-6 rounded-2xl border border-mist-200 bg-white max-md:mx-4">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-5 py-3 text-sm font-semibold text-navy-950 [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden="true" className="size-4 -rotate-90 text-navy-500 transition-transform group-open:rotate-0" />
            Archived courses
            <span className="rounded-full bg-mist-100 px-2 text-xs font-bold text-navy-800">{archived.length}</span>
          </summary>
          <div className="border-t border-mist-100 p-5 max-md:p-3">
            <p className="mb-4 text-meta text-muted">The trainer has archived these courses. You keep your progress and certificates.</p>
            <div className={GRID}>{archived.map((item) => <div key={item.id} className="contents">{item.card}</div>)}</div>
          </div>
        </details>
      ) : null}
    </div>
  )
}
