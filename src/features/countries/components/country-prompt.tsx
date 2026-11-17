'use client'

import { useActionState } from 'react'
import { MapPin, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dismissCountryPrompt, saveProfileCountries, type ProfileCountryActionState } from '../profile-country-actions'
import { CountrySelect } from './country-select'

/**
 * Round GP: the one "add your country" prompt on Home, for members with no country of residence. Never a blocker:
 * "Not now" closes it for good (on every device), and saving a country hides it too.
 */
export function CountryPrompt() {
  const [state, formAction, pending] = useActionState<ProfileCountryActionState, FormData>(saveProfileCountries, { status: 'idle', revision: 0 })
  if (state.status === 'saved') {
    return <p role="status" className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">Thanks, your country is saved.</p>
  }

  return (
    <section aria-labelledby="country-prompt-heading" className="relative rounded-2xl border border-ocean-100 bg-ocean-50/60 p-4">
      <form action={dismissCountryPrompt} className="absolute right-2 top-2">
        <button
          type="submit"
          aria-label="Close: don't ask about my country again"
          className="grid size-9 place-items-center rounded-full text-navy-900 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </form>
      <div className="flex items-start gap-3 pr-10">
        <MapPin aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ocean-700" />
        <div className="min-w-0">
          <h2 id="country-prompt-heading" className="text-base font-semibold text-navy-950">Which country do you live in?</h2>
          <p className="mt-1 text-sm leading-6 text-muted">It helps us connect you with partners near you. Only Sea N Shore sees it.</p>
        </div>
      </div>
      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2 sm:pl-8" noValidate>
        <label htmlFor="country-prompt-select" className="sr-only">Country of residence</label>
        <CountrySelect
          id="country-prompt-select"
          name="countryOfResidence"
          invalid={state.status === 'error'}
          errorId="country-prompt-error"
          className="min-h-10 min-w-0 flex-1 rounded-xl border border-mist-200 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500 sm:max-w-xs"
        />
        <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
      </form>
      {state.status === 'error' ? <p id="country-prompt-error" role="alert" className="mt-2 text-sm text-red-700 sm:pl-8">{state.message}</p> : null}
    </section>
  )
}
