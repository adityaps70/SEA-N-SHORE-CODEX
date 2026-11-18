'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { setOrganizationCountryAction, type AdminCountryActionState } from '../admin-country-actions'
import { CountrySelect } from './country-select'

/** Round GP: Admin sets (or clears) an organization's country. Every change is in the audit log. */
export function AdminOrganizationCountryForm({ companyId, country }: { companyId: string; country: string | null }) {
  const [state, formAction, pending] = useActionState<AdminCountryActionState, FormData>(setOrganizationCountryAction, { status: 'idle', revision: 0 })
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="companyId" value={companyId} />
      <div className="min-w-0 flex-1 text-sm font-medium text-navy-900 sm:max-w-sm">
        <label htmlFor="admin-organization-country" className="block">Country</label>
        <CountrySelect
          id="admin-organization-country"
          name="country"
          defaultValue={country}
          emptyLabel="Country not set"
          className="mt-1 min-h-10 w-full rounded-lg border border-mist-200 bg-white px-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save country'}</Button>
      <p role="status" aria-live="polite" className={`basis-full text-sm ${state.status === 'error' ? 'text-red-700' : 'text-muted'}`}>
        {state.status === 'idle' ? '' : state.message}
      </p>
    </form>
  )
}
