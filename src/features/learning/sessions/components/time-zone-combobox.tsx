'use client'

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { filterTimeZones, timeZoneChoices, timeZoneLabel } from '../time-zone-labels'

/**
 * Round H (H7): a searchable time-zone picker (ARIA combobox) with labels such as "Kolkata, India (UTC+5:30)",
 * sorted by offset. Type a city, country or offset; the stored value is the IANA name.
 */
export function TimeZoneCombobox({
  value,
  onChange,
  label = 'Time zone',
  className,
}: {
  value: string
  onChange: (zone: string) => void
  label?: string
  className?: string
}) {
  const listId = `${useId()}-zones`
  const choices = useMemo(() => timeZoneChoices(), [])
  const selectedLabel = useMemo(() => choices.find((choice) => choice.value === value)?.label ?? timeZoneLabel(value), [choices, value])
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLUListElement | null>(null)
  const results = useMemo(() => filterTimeZones(choices, query ?? ''), [choices, query])
  const expanded = open && results.length > 0

  function close() {
    setOpen(false)
    setActive(-1)
    setQuery(null)
  }

  function choose(zone: string) {
    onChange(zone)
    close()
  }

  function move(next: number) {
    setActive(next)
    listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        const current = results.findIndex((choice) => choice.value === value)
        move(current >= 0 ? current : 0)
        return
      }
      if (!results.length) return
      if (event.key === 'ArrowDown') move(active < results.length - 1 ? active + 1 : 0)
      else move(active > 0 ? active - 1 : results.length - 1)
      return
    }
    if (event.key === 'Enter' && expanded && active >= 0) {
      event.preventDefault()
      choose(results[active]!.value)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
    }
  }

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query ?? selectedLabel}
          placeholder="Search a city, country or UTC offset"
          onFocus={(event) => {
            setOpen(true)
            event.currentTarget.select()
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(event.target.value.trim() ? 0 : -1)
          }}
          onBlur={close}
          onKeyDown={onKeyDown}
          className="block min-h-11 w-full rounded-xl border border-mist-200 bg-white py-2 pl-3 pr-9 text-sm text-navy-950 focus:border-teal-500"
        />
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      </div>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Time zones"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-mist-100 bg-white py-1 text-sm shadow-[var(--shadow-card)]"
      >
        {expanded ? results.map((choice, index) => (
          <li
            key={choice.value}
            id={`${listId}-${index}`}
            data-index={index}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => {
              // mousedown, not click: the input keeps focus, so its blur does not close the list first.
              event.preventDefault()
              choose(choice.value)
            }}
            className={cn(
              'flex min-h-11 cursor-pointer items-center px-3 py-2',
              index === active ? 'bg-ocean-50 text-navy-950' : 'text-navy-900 hover:bg-mist-50',
              choice.value === value && 'font-semibold',
            )}
          >
            {choice.label}
          </li>
        )) : null}
      </ul>
      {open && !results.length ? <p role="status" className="mt-1 text-xs text-muted">No time zone matches. Try a city, a country or an offset like +5:30.</p> : null}
    </div>
  )
}
