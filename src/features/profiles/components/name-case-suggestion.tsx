'use client'

import { useCallback, useEffect, useState } from 'react'
import { nameCaseSuggestion } from '../display-name'

/**
 * Round H (H7): under a name field, "Did you mean Placeholder Member?" when the name is typed in ALL CAPS or all
 * lowercase, with a button that puts the suggestion in the field. Works with any input, by id; the member can
 * ignore it, and what they submit is stored as typed.
 */
export function NameCaseSuggestion({ inputId }: { inputId: string }) {
  const [suggestion, setSuggestion] = useState<string | null>(null)

  const check = useCallback((value: string) => setSuggestion(nameCaseSuggestion(value)), [])

  useEffect(() => {
    const input = document.getElementById(inputId) as HTMLInputElement | null
    if (!input) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the field's saved value from the DOM once after hydration
    check(input.value)
    // Suggest once the member leaves the field; while they type, only clear or update a shown suggestion.
    const onChange = () => check(input.value)
    const onInput = () => setSuggestion((current) => (current === null ? null : nameCaseSuggestion(input.value)))
    input.addEventListener('change', onChange)
    input.addEventListener('blur', onChange)
    input.addEventListener('input', onInput)
    return () => {
      input.removeEventListener('change', onChange)
      input.removeEventListener('blur', onChange)
      input.removeEventListener('input', onInput)
    }
  }, [inputId, check])

  function apply() {
    const input = document.getElementById(inputId) as HTMLInputElement | null
    if (!input || !suggestion) return
    // The native setter, so React-controlled inputs see the change too.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, suggestion)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    setSuggestion(null)
    input.focus()
  }

  return (
    // sr-only while empty: the live region stays in place without taking a row in grid forms.
    <div aria-live="polite" className={suggestion ? undefined : 'sr-only'}>
      {suggestion ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-navy-900">
          <span>Did you mean <strong className="font-semibold">{suggestion}</strong>?</span>
          <button
            type="button"
            onClick={apply}
            className="min-h-11 cursor-pointer rounded-lg px-2 font-semibold text-ocean-700 underline underline-offset-2 hover:text-navy-950"
          >
            Use {suggestion}
          </button>
        </p>
      ) : null}
    </div>
  )
}
