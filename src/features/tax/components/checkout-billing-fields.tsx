'use client'

import { useId, useState } from 'react'
import { Building2 } from 'lucide-react'
import { BILLING_COUNTRIES, type BillingInput } from '../billing'
import { GST_STATES } from '../gst'

const fieldClass = (invalid: boolean) =>
  `mt-1.5 min-h-11 w-full rounded-xl border bg-white px-3 text-sm text-navy-950 outline-none focus:ring-2 ${
    invalid ? 'border-red-400 focus:ring-red-100' : 'border-mist-200 focus:border-teal-500 focus:ring-teal-100'
  }`

/**
 * C4: the billing details for the GST invoice. INR: billing state (required), optional company name + GSTIN.
 * USD: billing country (the purchase is an export). The server checks them again when checkout starts.
 */
export function CheckoutBillingFields({
  currency,
  value,
  onChange,
  error,
}: {
  currency: 'INR' | 'USD'
  value: BillingInput
  onChange: (next: BillingInput) => void
  error: string | null
}) {
  const id = useId()
  const [businessOpen, setBusinessOpen] = useState(Boolean(value.company || value.gstin))
  const set = (patch: Partial<BillingInput>) => onChange({ ...value, ...patch })

  return (
    <fieldset className="space-y-3 rounded-xl border border-mist-200 p-3" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="px-1 text-sm font-bold text-navy-950">Billing details</legend>
      {currency === 'USD' ? (
        <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-country`}>
          Billing country
          <select
            id={`${id}-country`}
            className={fieldClass(Boolean(error) && !value.country)}
            value={value.country ?? ''}
            onChange={(event) => set({ country: event.target.value || null })}
          >
            <option value="">Choose your country</option>
            {BILLING_COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
      ) : (
        <>
          <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-state`}>
            Billing state
            <select
              id={`${id}-state`}
              required
              className={fieldClass(Boolean(error) && !value.stateCode)}
              value={value.stateCode ?? ''}
              onChange={(event) => set({ stateCode: event.target.value || null })}
            >
              <option value="">Choose your state</option>
              {GST_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
          {businessOpen ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-company`}>
                Company name
                <input
                  id={`${id}-company`}
                  className={fieldClass(false)}
                  value={value.company ?? ''}
                  maxLength={120}
                  autoComplete="organization"
                  onChange={(event) => set({ company: event.target.value })}
                />
              </label>
              <label className="block text-sm font-semibold text-navy-950" htmlFor={`${id}-gstin`}>
                GSTIN
                <input
                  id={`${id}-gstin`}
                  className={`${fieldClass(false)} uppercase`}
                  value={value.gstin ?? ''}
                  maxLength={15}
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="27ABCDE1234F1Z5"
                  onChange={(event) => set({ gstin: event.target.value })}
                />
              </label>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setBusinessOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-ocean-700 underline-offset-2 hover:underline"
            >
              <Building2 aria-hidden="true" className="size-4" /> Buying for a company? Add its GSTIN
            </button>
          )}
        </>
      )}
      {error ? <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-700">{error}</p> : null}
    </fieldset>
  )
}
