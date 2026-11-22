'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { COUNTRY_OPTIONS } from '@/features/countries/catalog'
import {
  COUNTRY_ADMIN_SECTION_INFO,
  DEFAULT_COUNTRY_ADMIN_PERMISSIONS,
  LIVE_COUNTRY_ADMIN_SECTIONS,
  VIEW_ONLY_SECTIONS,
  type CountryAdminPermissions,
} from '../sections'
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

/** One section's two tickboxes. Ticking Act also ticks View (act includes view); unticking View unticks Act. */
function SectionRow({ idPrefix, section, initial }: { idPrefix: string; section: (typeof LIVE_COUNTRY_ADMIN_SECTIONS)[number]; initial: 'view' | 'act' | undefined }) {
  const [view, setView] = useState(initial === 'view' || initial === 'act')
  const [act, setAct] = useState(initial === 'act')
  const info = COUNTRY_ADMIN_SECTION_INFO[section]
  const viewOnly = VIEW_ONLY_SECTIONS.includes(section)
  const viewId = `${idPrefix}-view-${section}`
  const actId = `${idPrefix}-act-${section}`
  return (
    <tr>
      <th scope="row" className="py-1.5 pr-3 text-left align-top font-normal">
        <span className="font-semibold text-navy-950">{info.label}</span>
        <span className="block text-xs text-muted">{info.act ? `View: ${info.view}. Act: ${info.act}.` : info.view}</span>
      </th>
      <td className="px-2 py-1.5 text-center align-top">
        <input
          id={viewId}
          type="checkbox"
          name={`view_${section}`}
          value="1"
          checked={view}
          onChange={(event) => { setView(event.target.checked); if (!event.target.checked) setAct(false) }}
          aria-label={`${info.label}: view`}
          className="size-4"
        />
      </td>
      <td className="px-2 py-1.5 text-center align-top">
        {viewOnly ? <span className="text-xs text-muted" aria-label={`${info.label}: view only`}>—</span> : (
          <input
            id={actId}
            type="checkbox"
            name={`act_${section}`}
            value="1"
            checked={act}
            onChange={(event) => { setAct(event.target.checked); if (event.target.checked) setView(true) }}
            aria-label={`${info.label}: act`}
            className="size-4"
          />
        )}
      </td>
    </tr>
  )
}

/**
 * Round GP Part E: what this country admin may use, as View and Act tickboxes per section. Every section is limited
 * to their countries; their admin menu and Overview show only the sections ticked here.
 */
function SectionFields({ idPrefix, permissions }: { idPrefix: string; permissions: CountryAdminPermissions }) {
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-sm font-medium text-navy-900">Sections (limited to their countries)</legend>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th scope="col" className="pb-1 text-left font-semibold">Section</th>
            <th scope="col" className="w-16 pb-1 font-semibold">View</th>
            <th scope="col" className="w-16 pb-1 font-semibold">Act</th>
          </tr>
        </thead>
        <tbody>
          {LIVE_COUNTRY_ADMIN_SECTIONS.map((section) => (
            <SectionRow key={section} idPrefix={idPrefix} section={section} initial={permissions[section]} />
          ))}
        </tbody>
      </table>
    </fieldset>
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
      <div className="md:col-span-3"><SectionFields idPrefix="country-admin-new" permissions={DEFAULT_COUNTRY_ADMIN_PERMISSIONS} /></div>
      <div className="md:col-span-3"><Status state={state} /></div>
    </form>
  )
}

/** Change a country admin's countries and sections, or remove the role. */
export function EditCountryAdminForm({ profileId, name, countries, permissions }: { profileId: string; name: string; countries: readonly string[]; permissions: CountryAdminPermissions }) {
  const [updateState, updateAction, updating] = useActionState(updateCountryAdminAction, idle)
  const [removeState, removeAction, removing] = useActionState(removeCountryAdminAction, idle)
  const selectId = `country-admin-${profileId}`
  return (
    <div className="grid gap-2">
      <form action={updateAction} className="grid gap-2">
        <input type="hidden" name="profileId" value={profileId} />
        <label htmlFor={selectId} className="sr-only">Countries for {name}</label>
        <CountriesSelect id={selectId} selected={countries} />
        <SectionFields idPrefix={selectId} permissions={permissions} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={updating}>{updating ? 'Saving…' : 'Save countries and sections'}</Button>
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
