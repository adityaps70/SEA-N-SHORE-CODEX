'use client'

import { useId, useState, useTransition } from 'react'
import { setPrivacyChoice } from '@/features/profiles/privacy-actions'

/**
 * Round H (H2): one privacy choice (a radio group) that saves as soon as it changes.
 * Every prop is plain data: the Server Component page renders this, and React cannot pass functions to a Client
 * Component (that failed every load of Settings › Privacy in production). After saving it says
 * "Saved: <label>." unless `savedMessages` has a message for that value.
 */
export function PrivacyChoice<T extends string>({
  setting,
  legend,
  description,
  options,
  initialValue,
  savedMessages,
}: {
  setting: 'messagePermission' | 'connectionsVisibility'
  legend: string
  description: string
  options: ReadonlyArray<{ value: T; label: string }>
  initialValue: T
  savedMessages?: Partial<Record<T, string>>
}) {
  const [value, setValue] = useState(initialValue)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const id = useId()

  function change(next: T) {
    const previous = value
    setValue(next)
    setStatus(null)
    startTransition(async () => {
      const result = await setPrivacyChoice(setting, next)
      if (result.ok) setStatus(savedMessages?.[next] ?? `Saved: ${options.find((option) => option.value === next)?.label ?? next}.`)
      else {
        setValue(previous)
        setStatus(result.error)
      }
    })
  }

  return (
    <fieldset aria-describedby={`${id}-description`}>
      <legend className="text-[15px] font-semibold text-navy-950">{legend}</legend>
      <p id={`${id}-description`} className="mt-0.5 text-sm leading-5 text-muted">{description}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-mist-200 px-3 text-sm font-semibold text-navy-950 has-[:checked]:border-ocean-700 has-[:checked]:bg-ocean-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ocean-500"
          >
            <input
              type="radio"
              name={`${id}-${setting}`}
              value={option.value}
              checked={value === option.value}
              disabled={pending}
              onChange={() => change(option.value)}
              className="size-4 accent-ocean-700"
            />
            {option.label}
          </label>
        ))}
      </div>
      <p role="status" className="mt-2 min-h-5 text-sm text-muted">{status}</p>
    </fieldset>
  )
}
