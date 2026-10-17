'use client'

import { useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import Link from '@/components/navigation/intent-link'
import { FaqAccordion } from './faq-accordion'
import type { FaqGroup } from './faq-data'
import { searchFaqGroups } from './faq-search-filter'

/**
 * Round H (H7): search over the /help FAQ, in the browser. A labelled search box filters the
 * questions as you type (question and answer text, every word must match), a polite live region
 * reads the number of matches, and groups with no match are hidden. Without JavaScript every
 * question stays listed.
 */
export function FaqSearch({ groups }: { groups: FaqGroup[] }) {
  const [query, setQuery] = useState('')
  const id = useId()
  const results = useMemo(() => searchFaqGroups(groups, query), [groups, query])
  const searching = query.trim().length > 0

  const status = !searching
    ? ''
    : results.total === 0
      ? `No questions match “${query.trim()}”.`
      : `${results.total} ${results.total === 1 ? 'question matches' : 'questions match'} “${query.trim()}”.`

  return (
    <>
      <div role="search" aria-label="Search the FAQ" className="mt-5">
        <label htmlFor={`${id}-input`} className="text-sm font-semibold text-navy-900">Search the questions</label>
        <span className="relative mt-1.5 block">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            id={`${id}-input`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="For example: password, refund, message"
            autoComplete="off"
            aria-describedby={`${id}-status`}
            aria-controls="faq-groups"
            className="min-h-11 w-full min-w-0 rounded-xl border border-mist-200 bg-white pl-10 pr-3.5 text-base text-ink placeholder:text-muted focus:border-ocean-600 focus:outline-none focus:ring-2 focus:ring-ocean-200"
          />
        </span>
        <span id={`${id}-status`} role="status" aria-live="polite" className="mt-2 block min-h-5 text-sm text-muted">{status}</span>
        {searching && results.total === 0 ? (
          <span className="block text-sm text-muted">
            Try another word, or{' '}
            <Link href="/contact#contact-form" className="font-semibold text-ocean-700 hover:underline">contact support</Link>.
          </span>
        ) : null}
      </div>
      <div id="faq-groups" className="mt-6 grid gap-8">
        {results.groups.map(({ group, items }) => (
          <div key={group.id} id={`faq-${group.id}`} className="scroll-mt-24" hidden={searching && items.length === 0}>
            <h3 className="text-lg font-semibold text-navy-950">{group.title}</h3>
            <div className="mt-3">
              <FaqAccordion items={items} idPrefix={`faq-${group.id}`} />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
