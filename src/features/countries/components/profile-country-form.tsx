'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { saveProfileCountries, type ProfileCountryActionState } from '../profile-country-actions'
import { CountrySelect } from './country-select'

const selectClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500 aria-[invalid=true]:border-red-300'

/** Round GP: Edit profile › Country. Both optional; saved on their own, separate from the profile details form. */
export function ProfileCountryForm({ countryOfResidence, nationality }: { countryOfResidence: string | null; nationality: string | null }) {
  const [state, formAction, pending] = useActionState<ProfileCountryActionState, FormData>(saveProfileCountries, { status: 'idle', revision: 0 })
  const residenceError = state.fieldErrors?.countryOfResidence
  const nationalityError = state.fieldErrors?.nationality

  return (
    <section aria-labelledby="profile-country-heading" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <h2 id="profile-country-heading" className="text-xl font-bold text-navy-950">Country</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        Where you live, and your nationality. Sea N Shore uses these to show you the right partners and prices. They are not shown on your public profile.
      </p>
      <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2" noValidate>
        <div className="text-sm font-medium text-navy-900">
          <label htmlFor="countryOfResidence">Country of residence</label>
          <CountrySelect
            id="countryOfResidence"
            name="countryOfResidence"
            defaultValue={countryOfResidence}
            emptyLabel="Not set"
            invalid={Boolean(residenceError)}
            errorId="countryOfResidence-error"
            className={selectClass}
          />
          {residenceError ? <span id="countryOfResidence-error" className="mt-1 block text-red-700">{residenceError}</span> : null}
        </div>
        <div className="text-sm font-medium text-navy-900">
          <label htmlFor="nationality">Nationality</label>
          <CountrySelect
            id="nationality"
            name="nationality"
            defaultValue={nationality}
            emptyLabel="Not set"
            invalid={Boolean(nationalityError)}
            errorId="nationality-error"
            className={selectClass}
          />
          {nationalityError ? <span id="nationality-error" className="mt-1 block text-red-700">{nationalityError}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save country'}</Button>
          <p role="status" aria-live="polite" className={state.status === 'error' ? 'text-sm text-red-700' : 'text-sm text-muted'}>
            {state.status === 'idle' ? '' : state.message}
          </p>
        </div>
      </form>
    </section>
  )
}
