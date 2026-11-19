'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { COUNTRY_OPTIONS } from '@/features/countries/catalog'
import {
  grantCountryAdminAction,
  removeCountryAdminAction,
  updateCountryAdminAction,
  type CountryAdminActionState,
} from '../admin-actions'

const idle: CountryAdminActionState = { status: 'idle', revision: 0 }
const inputClass = 'mt-1 w-full rounded-lg border border-mist-200 bg-white px-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100'

function Status({ state }: { state: CountryAdminActionState }) {
  return (
    <p role="status" aria-live="polite" className={`text-sm ${state.status === 'error' ? 'text-red-700' : 'text-muted'}`}>
      {state.status === 'idle' ? '' : state.message}
    </p>
  )
}

/** A native multi-select of every country (Ctrl / Cmd-click to choose several; type to jump). */
function CountriesSelect({ id, selected }: { id: string; selected?: readonly string[] }) {
  return (
    <select id={id} name="countries" multiple required size={8} defaultValue={[...(selected ?? [])]} className={`${inputClass} py-1`}>
      {COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
    </select>
  )
}

/** Round GP (Part C): make an existing member a country admin, by their exact username or sign-in email. */
export function GrantCountryAdminForm() {
  const [state, formAction, pending] = useActionState(grantCountryAdminAction, idle)
  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start">
      <div className="text-sm font-medium text-navy-900">
        <label htmlFor="country-admin-member">Member’s username or sign-in email</label>
        <input id="country-admin-member" name="member" required maxLength={320} autoComplete="off" placeholder="e.g. maria-santos or name@example.com" className={`${inputClass} min-h-10`} />
        <p className="mt-1 text-xs font-normal text-muted">An exact match only. The member must already have a Sea N Shore account.</p>
      </div>
      <div className="text-sm font-medium text-navy-900">
        <label htmlFor="country-admin-countries">Countries</label>
        <CountriesSelect id="country-admin-countries" />
        <p className="mt-1 text-xs font-normal text-muted">Hold Ctrl (Cmd on a Mac) to choose more than one.</p>
      </div>
      <div className="grid gap-2 md:pt-6">
        <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Make country admin'}</Button>
      </div>
      <div className="md:col-span-3"><Status state={state} /></div>
    </form>
  )
}

/** Change a country admin's countries, or remove the role. */
export function EditCountryAdminForm({ profileId, name, countries }: { profileId: string; name: string; countries: readonly string[] }) {
  const [updateState, updateAction, updating] = useActionState(updateCountryAdminAction, idle)
  const [removeState, removeAction, removing] = useActionState(removeCountryAdminAction, idle)
  const selectId = `country-admin-${profileId}`
  return (
    <div className="grid gap-2">
      <form action={updateAction} className="grid gap-2">
        <input type="hidden" name="profileId" value={profileId} />
        <label htmlFor={selectId} className="sr-only">Countries for {name}</label>
        <CountriesSelect id={selectId} selected={countries} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={updating}>{updating ? 'Saving…' : 'Save countries'}</Button>
          <Status state={updateState} />
        </div>
      </form>
      <form
        action={removeAction}
        onSubmit={(event) => {
          if (!window.confirm(`Remove ${name} as a country admin? They lose access to the admin console at once.`)) event.preventDefault()
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="profileId" value={profileId} />
        <Button type="submit" size="sm" variant="secondary" disabled={removing}>{removing ? 'Removing…' : 'Remove country admin'}</Button>
        <Status state={removeState} />
      </form>
    </div>
  )
}
