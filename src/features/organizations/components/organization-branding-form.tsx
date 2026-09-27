'use client'

import Image from 'next/image'
import { useActionState } from 'react'
import { ImageUp } from 'lucide-react'
import { FormErrorSummary } from '@/components/ui/form-error-summary'
import { updateOrganizationBranding, type OrganizationBrandingActionState } from '../workspace-actions'
import type { OrganizationWorkspace } from '../workspace-repository'
import { WELLBEING_SERVICES, isWellbeingType, organizationTypeHasField } from '../organization-types'

const initialState: OrganizationBrandingActionState = {}

export function OrganizationBrandingForm({ workspace }: { workspace: OrganizationWorkspace }) {
  const [state, formAction, pending] = useActionState(updateOrganizationBranding, initialState)
  const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-navy-950 outline-none focus:border-ocean-500'
  const labelClass = 'block text-sm font-semibold text-navy-950'
  const error = (name: string) => state.fieldErrors?.[name]?.[0]
  // Keep maritime fields for types that use them, or when older data is already stored.
  const showOperations = organizationTypeHasField(workspace.organizationType, 'fleetSummary') || Boolean(workspace.fleetSummary)
  const showVesselTypes = organizationTypeHasField(workspace.organizationType, 'vesselTypes') || workspace.vesselTypes.length > 0
  const wellbeing = isWellbeingType(workspace.organizationType)

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="companyId" value={workspace.id} />
      <FormErrorSummary
        error={state.error}
        fieldErrors={state.fieldErrors}
        fieldLabels={{
          website: 'Website',
          description: 'Organization description',
          fleetSummary: 'Operations summary',
          vesselTypes: 'Vessel types',
          officeLocations: 'Office locations',
          servicesOffered: 'Services offered',
          languages: 'Languages',
          helpline24x7: '24/7 helpline',
        }}
      />

      {state.success ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">Organization branding updated.</p> : null}

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass + ' sm:col-span-2'}>
            Organization logo
            <span className="mt-1 flex min-h-28 items-center gap-4 rounded-2xl border border-dashed border-mist-200 bg-mist-50 p-4">
              {workspace.logoPath ? (
                <Image
                  src={'/api/company-logo/' + workspace.id}
                  alt=""
                  width={64}
                  height={64}
                  unoptimized
                  className="size-16 rounded-xl bg-white object-contain"
                />
              ) : (
                <span className="grid size-16 place-items-center rounded-xl bg-white text-ocean-700"><ImageUp aria-hidden="true" className="size-6" /></span>
              )}
              <span className="min-w-0 flex-1">
                <input name="logo" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-navy-950 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white" />
                <span className="mt-1 block text-xs font-normal text-muted">JPG, PNG or WebP. Maximum 5 MB. Leave empty to keep the current logo.</span>
              </span>
            </span>
          </label>

          <label className={labelClass}>
            Website
            <input name="website" type="url" maxLength={320} defaultValue={workspace.website ?? ''} className={inputClass} />
            {error('website') ? <span className="mt-1 block text-xs text-red-700">{error('website')}</span> : null}
          </label>

          <label className={labelClass}>
            Office locations
            <input name="officeLocations" maxLength={2000} defaultValue={workspace.officeLocations.join(', ')} className={inputClass} placeholder="Mumbai, Singapore" />
            {error('officeLocations') ? <span className="mt-1 block text-xs text-red-700">{error('officeLocations')}</span> : null}
          </label>

          <label className={labelClass + ' sm:col-span-2'}>
            Organization description
            <textarea name="description" maxLength={4000} defaultValue={workspace.description ?? ''} className={inputClass + ' min-h-36 py-3'} />
            {error('description') ? <span className="mt-1 block text-xs text-red-700">{error('description')}</span> : null}
          </label>

          {showOperations ? (
            <label className={labelClass + ' sm:col-span-2'}>
              Operations / fleet summary
              <textarea name="fleetSummary" maxLength={2000} defaultValue={workspace.fleetSummary ?? ''} className={inputClass + ' min-h-28 py-3'} />
              {error('fleetSummary') ? <span className="mt-1 block text-xs text-red-700">{error('fleetSummary')}</span> : null}
            </label>
          ) : null}

          {showVesselTypes ? (
            <label className={labelClass + ' sm:col-span-2'}>
              Vessel / service types
              <input name="vesselTypes" maxLength={3000} defaultValue={workspace.vesselTypes.join(', ')} className={inputClass} placeholder="Oil Tanker, Bulk Carrier, Training, Survey" />
              {error('vesselTypes') ? <span className="mt-1 block text-xs text-red-700">{error('vesselTypes')}</span> : null}
            </label>
          ) : null}

          {wellbeing ? (
            <>
              <fieldset className="sm:col-span-2">
                <legend className={labelClass}>Services offered</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {WELLBEING_SERVICES.map((service) => (
                    <label key={service.value} className="flex min-h-10 items-center gap-2 rounded-lg border border-mist-100 px-3 text-sm text-navy-900 has-[:checked]:border-teal-300 has-[:checked]:bg-teal-50">
                      <input type="checkbox" name="servicesOffered" value={service.value} defaultChecked={workspace.details.servicesOffered?.includes(service.value) ?? false} className="size-4 accent-teal-700" />
                      {service.label}
                    </label>
                  ))}
                </div>
                {error('servicesOffered') ? <span className="mt-1 block text-xs text-red-700">{error('servicesOffered')}</span> : null}
              </fieldset>
              <label className={labelClass}>
                Languages
                <input name="languages" maxLength={600} defaultValue={workspace.details.languages?.join(', ') ?? ''} className={inputClass} placeholder="English, Hindi, Tagalog" />
                {error('languages') ? <span className="mt-1 block text-xs text-red-700">{error('languages')}</span> : null}
              </label>
              <fieldset>
                <legend className={labelClass}>24/7 helpline</legend>
                <div className="mt-1 flex gap-2">
                  {(['yes', 'no'] as const).map((value) => (
                    <label key={value} className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-mist-100 px-3 text-sm text-navy-900 has-[:checked]:border-teal-300 has-[:checked]:bg-teal-50">
                      <input type="radio" name="helpline24x7" value={value} defaultChecked={workspace.details.helpline24x7 === (value === 'yes')} className="size-4 accent-teal-700" />
                      {value === 'yes' ? 'Yes, 24/7' : 'No'}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end">
          <button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white disabled:opacity-50">
            {pending ? 'Saving…' : 'Save organization branding'}
          </button>
        </div>
      </section>
    </form>
  )
}
