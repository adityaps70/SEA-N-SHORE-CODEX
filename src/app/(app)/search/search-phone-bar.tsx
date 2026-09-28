'use client'

import { Search } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import type { SearchChip } from './search-filters'

const PHONE_QUERY = '(max-width: 767.98px)'

/**
 * Phone search bar: back arrow + the live search input (focused when there is no query yet).
 * Desktop keeps the hero search form.
 */
export function SearchPhoneBar({ query, chip }: { query: string; chip: SearchChip }) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (query) return
    // Only phones focus this input; on desktop the bar is hidden and the hero input autofocuses.
    if (typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches) {
      inputRef.current?.focus()
    }
  }, [query])

  return (
    <MobilePageBar
      backHref="/home"
      className="!mb-0 pr-3"
      title={(
        <form action="/search" method="get" role="search" aria-label="Search Sea N Shore" className="relative py-2">
          {chip !== 'all' ? <input type="hidden" name="type" value={chip} /> : null}
          <label htmlFor="global-search-phone" className="sr-only">Search Sea N Shore</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-navy-700" />
          <input
            ref={inputRef}
            id="global-search-phone"
            name="q"
            type="search"
            enterKeyHint="search"
            defaultValue={query}
            maxLength={100}
            placeholder="Search jobs, people, courses"
            className="min-h-11 w-full rounded-full border border-ocean-700 bg-white py-2 pl-11 pr-4 text-base font-normal text-ink outline-none placeholder:text-muted focus:ring-1 focus:ring-inset focus:ring-ocean-700"
          />
        </form>
      )}
    />
  )
}
