'use client'

import { useId, useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { TaxonomyDatalist } from './taxonomy-datalist'

function splitValues(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

/**
 * Round G (G0.1): vessel types as chips picked from the taxonomy (searchable list), still accepting
 * any other text. Submits the same comma-separated field the form always sent, so server-side
 * validation is unchanged; codes are filled from the text on save.
 */
export function VesselTypesInput({
  name,
  label,
  defaultValue,
  inputClassName,
  maxItems = 20,
}: {
  name: string
  label: string
  defaultValue: string
  inputClassName: string
  maxItems?: number
}) {
  const [values, setValues] = useState(() => splitValues(defaultValue))
  const [draft, setDraft] = useState('')
  const id = useId()
  const listId = `${id}-options`
  const labelId = `${id}-label`

  function add() {
    const next = splitValues(draft)
    if (!next.length) return
    setValues((current) => {
      const lower = new Set(current.map((value) => value.toLocaleLowerCase()))
      const merged = [...current]
      for (const value of next) {
        if (!lower.has(value.toLocaleLowerCase()) && merged.length < maxItems) {
          merged.push(value)
          lower.add(value.toLocaleLowerCase())
        }
      }
      return merged
    })
    setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      add()
    } else if (event.key === 'Backspace' && !draft && values.length) {
      setValues((current) => current.slice(0, -1))
    }
  }

  return (
    <div role="group" aria-labelledby={labelId}>
      <span id={labelId}>{label}</span>
      {values.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Selected ${label.toLocaleLowerCase()}`}>
          {values.map((value) => (
            <li key={value} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-ocean-50 pl-3 pr-1 text-sm font-medium text-ocean-800">
              {value}
              <button
                type="button"
                onClick={() => setValues((current) => current.filter((item) => item !== value))}
                aria-label={`Remove ${value}`}
                className="grid size-7 place-items-center rounded-full hover:bg-ocean-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          aria-labelledby={labelId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          list={listId}
          autoComplete="off"
          maxLength={120}
          placeholder={values.length ? 'Add another' : 'Start typing: Oil Tanker, LNG Carrier…'}
          className={inputClassName}
        />
        <button
          type="button"
          onClick={add}
          aria-label={`Add to ${label.toLocaleLowerCase()}`}
          className="mt-1 grid size-11 shrink-0 place-items-center rounded-xl border border-mist-200 text-ocean-700 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
        >
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </div>
      <TaxonomyDatalist id={listId} kind="vessel" />
      <input type="hidden" name={name} value={values.join(', ')} />
    </div>
  )
}
