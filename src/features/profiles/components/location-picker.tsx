'use client'

import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { MapPin } from 'lucide-react'
import { cn } from '@/lib/cn'
import { findCityOption, searchCities } from '../location/city-search'

/**
 * Round H (H7): the profile location as a searchable city picker (ARIA combobox) over an offline list of major
 * cities. Choosing a city stores "City, Country" in the same location text field as before. "Other" keeps what the
 * member typed, and a saved free-text location stays as it is until the member changes it.
 */
type Option = { kind: 'city'; label: string } | { kind: 'other'; label: string }

export function LocationPicker({
  id,
  name = 'location',
  defaultValue = '',
  maxLength = 120,
  className,
  invalid = false,
  errorId,
}: {
  id: string
  name?: string
  defaultValue?: string
  maxLength?: number
  /** Classes for the text input. */
  className?: string
  invalid?: boolean
  /** Id of the field's error message, when one is shown. */
  errorId?: string
}) {
  const listId = `${useId()}-cities`
  const hintId = `${id}-hint`
  const [value, setValue] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // "Other" chosen (or a saved free-text location): no suggestions until the member types again.
  const [custom, setCustom] = useState(() => Boolean(defaultValue.trim()) && !findCityOption(defaultValue))
  const legacy = Boolean(defaultValue.trim()) && !findCityOption(defaultValue) && value === defaultValue

  const options = useMemo<Option[]>(() => {
    const typed = value.trim()
    if (!typed) return []
    const cities = searchCities(typed).map((city) => ({ kind: 'city' as const, label: city.label }))
    const exact = cities.some((city) => city.label.toLowerCase() === typed.toLowerCase())
    return exact ? cities : [...cities, { kind: 'other' as const, label: `Other: type your location (“${typed}”)` }]
  }, [value])
  const expanded = open && !custom && options.length > 0

  function choose(option: Option) {
    if (option.kind === 'city') {
      setValue(option.label)
      setCustom(false)
    } else {
      setCustom(true)
    }
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (custom) setCustom(false)
      if (!options.length) return
      event.preventDefault()
      setOpen(true)
      setActive((current) => {
        if (event.key === 'ArrowDown') return current < options.length - 1 ? current + 1 : 0
        return current > 0 ? current - 1 : options.length - 1
      })
      return
    }
    if (event.key === 'Enter' && expanded && active >= 0) {
      event.preventDefault()
      choose(options[active]!)
      return
    }
    if (event.key === 'Escape' && expanded) {
      event.preventDefault()
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <MapPin aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          id={id}
          name={name}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(' ')}
          autoComplete="off"
          maxLength={maxLength}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setOpen(true)
            setActive(-1)
            setCustom(false)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            setActive(-1)
          }}
          onKeyDown={onKeyDown}
          placeholder="Start typing a city"
          className={cn(className, 'pl-9')}
        />
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="Cities"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-mist-100 bg-white py-1 text-sm shadow-[var(--shadow-card)]"
      >
        {options.map((option, index) => (
          <li
            key={`${option.kind}-${option.label}`}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            // mousedown, not click: the input keeps focus, so its blur does not close the list first.
            onMouseDown={(event) => {
              event.preventDefault()
              choose(option)
            }}
            className={cn(
              'flex min-h-11 cursor-pointer items-center px-3 py-2',
              index === active ? 'bg-ocean-50 text-navy-950' : 'text-navy-900 hover:bg-mist-50',
              option.kind === 'other' && 'border-t border-mist-100 font-semibold text-ocean-700',
            )}
          >
            {option.label}
          </li>
        ))}
      </ul>
      <p id={hintId} className="mt-1 text-xs font-normal leading-5 text-muted">
        {legacy
          ? 'Your saved location is not in the city list. Choose a city to update it, or keep it as it is.'
          : 'Choose a city from the list, or pick “Other” to keep what you typed.'}
      </p>
    </div>
  )
}
