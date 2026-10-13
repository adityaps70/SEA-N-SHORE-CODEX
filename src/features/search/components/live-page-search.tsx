'use client'

import { LoaderCircle, Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { recordSearchAction } from '../search-actions'

/**
 * Round G (G4): the /search field. Results and tabs update as the member types: 250 ms after the
 * last keystroke the URL is replaced (history.replaceState via the router, so back and forward
 * still work) and the server renders the new results. The old results stay on screen with a small
 * loading hint until the new ones are ready; a newer navigation always wins over an older one.
 */
export function LivePageSearch({ initialQuery, tab, resultCount, autoFocus = false }: { initialQuery: string; tab: string; resultCount: number; autoFocus?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const [text, setText] = useState(initialQuery)
  const [pending, startTransition] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function navigate(value: string) {
    const params = new URLSearchParams()
    if (value.trim()) params.set('q', value.trim())
    if (tab !== 'all') params.set('type', tab)
    const href = params.size ? `${pathname}?${params.toString()}` : pathname
    startTransition(() => router.replace(href, { scroll: false }))
  }

  return (
    <form
      role="search"
      action="/search"
      method="get"
      onSubmit={(event) => {
        event.preventDefault()
        if (timer.current) clearTimeout(timer.current)
        if (text.trim()) void recordSearchAction(text.trim(), resultCount)
        navigate(text)
      }}
      className="relative"
    >
      <label htmlFor="search-page-input" className="sr-only">Search Sea N Shore</label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
      <input
        id="search-page-input"
        name="q"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        maxLength={80}
        autoFocus={autoFocus}
        value={text}
        placeholder="Search people, posts, jobs, organizations, communities, courses or events"
        aria-describedby="search-page-hint"
        onChange={(event) => {
          const value = event.target.value
          setText(value)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => navigate(value), 250)
        }}
        className="min-h-12 w-full rounded-xl border border-mist-200 bg-white py-3 pl-12 pr-10 text-base text-ink outline-none placeholder:text-muted focus:border-ocean-700 focus:ring-1 focus:ring-ocean-700 md:text-sm"
      />
      {pending ? <LoaderCircle aria-hidden="true" className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" /> : null}
      <p id="search-page-hint" className="sr-only">Results update as you type.</p>
      <p role="status" aria-live="polite" className="sr-only">{pending ? 'Updating results' : ''}</p>
    </form>
  )
}
