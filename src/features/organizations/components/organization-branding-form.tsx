'use client'

import Image from 'next/image'
import { useActionState, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { ImageUp } from 'lucide-react'
import { FormErrorSummary } from '@/components/ui/form-error-summary'
import { updateOrganizationBranding, type OrganizationBrandingActionState } from '../workspace-actions'
import type { OrganizationWorkspace } from '../workspace-repository'
import { WELLBEING_SERVICES, isWellbeingType, organizationTypeHasField } from '../organization-types'
import {
  BRANDING_IMAGE_TYPES,
  COMPANY_SIZES,
  TAGLINE_MAX_LENGTH,
  brandingImagesProblem,
  organizationCoverUrl,
  organizationLogoUrl,
} from '../organization-page-profile'

const initialState: OrganizationBrandingActionState = {}
const IMAGE_TYPES = new Set<string>(BRANDING_IMAGE_TYPES)

function usePreview() {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])
  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setPreview(file && IMAGE_TYPES.has(file.type) && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null)
  }
  return [preview, onChange] as const
}

function chosenFile(value: FormDataEntryValue | null) {
  return value instanceof File && value.size > 0 ? value : null
}

export function OrganizationBrandingForm({ workspace }: { workspace: OrganizationWorkspace }) {
  const [state, formAction, pending] = useActionState(updateOrganizationBranding, initialState)
  const [clientError, setClientError] = useState<string | null>(null)
  const [logoPreview, onLogoChange] = usePreview()
  const [coverPreview, onCoverChange] = usePreview()
  const [removeCover, setRemoveCover] = useState(false)
  const [tagline, setTagline] = useState(workspace.tagline ?? '')
  const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-normal text-navy-950 outline-none focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100'
  const labelClass = 'block text-sm font-semibold text-navy-950'
  const hintClass = 'mt-1 block text-xs font-normal text-muted'
  const fileClass = 'block w-full cursor-pointer text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-navy-950 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-navy-900'
  const error = (name: string) => state.fieldErrors?.[name]?.[0]
  // Keep maritime fields for types that use them, or when older data is already stored.
  const showOperations = organizationTypeHasField(workspace.organizationType, 'fleetSummary') || Boolean(workspace.fleetSummary)
  const showVesselTypes = organizationTypeHasField(workspace.organizationType, 'vesselTypes') || workspace.vesselTypes.length > 0
  const wellbeing = isWellbeingType(workspace.organizationType)
  const logoUrl = organizationLogoUrl(workspace)
  const coverUrl = removeCover ? null : coverPreview ?? organizationCoverUrl(workspace)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget)
    const message = brandingImagesProblem(chosenFile(data.get('logo')), chosenFile(data.get('cover')))
    setClientError(message)
    if (message) event.preventDefault()
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-5">
      <input type="hidden" name="companyId" value={workspace.id} />
      <FormErrorSummary
        error={clientError ?? state.error}
        fieldErrors={clientError ? undefined : state.fieldErrors}
        fieldLabels={{
          website: 'Website',
          description: 'Organization description',
          tagline: 'Tagline',
          companySize: 'Company size',
          specialties: 'Specialities',
          fleetSummary: 'Operations summary',
          vesselTypes: 'Vessel types',
          officeLocations: 'Office locations',
          servicesOffered: 'Services offered',
          languages: 'Languages',
          helpline24x7: '24/7 helpline',
        }}
      />

      {state.success && !clientError ? <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">Page details saved. Members see the changes on your organization page now.</p> : null}

      <section aria-labelledby="branding-images-heading" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 id="branding-images-heading" className="text-base font-bold text-navy-950">Logo and cover image</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-mist-100">
          <div aria-hidden="true" className="relative h-28 bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))] sm:h-36">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview or private media route
              <img src={coverUrl} alt="" className="size-full object-cover" />
            ) : null}
          </div>
          <div className="-mt-9 px-4 pb-3">
            <span className="relative grid size-18 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-white shadow-sm">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
                <img src={logoPreview} alt="" className="size-full object-contain" />
              ) : logoUrl ? (
                <Image src={logoUrl} alt="" width={72} height={72} unoptimized className="size-full bg-white object-contain" />
              ) : (
                <ImageUp aria-hidden="true" className="size-6 text-ocean-700" />
              )}
            </span>
            <p className="mt-1 text-xs text-muted">Preview of your page header</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Organization logo
            <input name="logo" type="file" accept="image/jpeg,image/png,image/webp" onChange={onLogoChange} className={`${fileClass} mt-2`} />
            <span className={hintClass}>Square image works best. JPG, PNG or WebP, up to 5 MB. Leave empty to keep the current logo.</span>
          </label>
          <div>
            <label className={labelClass}>
              Cover image
              <input name="cover" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setRemoveCover(false); onCoverChange(event) }} className={`${fileClass} mt-2`} />
              <span className={hintClass}>Wide image, about 1584 × 396 pixels. JPG, PNG or WebP, up to 5 MB.</span>
            </label>
            {workspace.coverPath ? (
              <label className="mt-2 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-mist-100 px-3 text-sm text-navy-900 hover:bg-mist-50 has-[:checked]:border-red-200 has-[:checked]:bg-red-50">
                <input type="checkbox" name="removeCover" checked={removeCover} onChange={(event) => setRemoveCover(event.target.checked)} className="size-4 accent-red-700" />
                Remove the cover image
              </label>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="branding-details-heading" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 id="branding-details-heading" className="text-base font-bold text-navy-950">Page details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={labelClass + ' sm:col-span-2'}>
            Tagline
            <input
              name="tagline"
              maxLength={TAGLINE_MAX_LENGTH}
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              className={inputClass}
              placeholder="For example: Ship management for tankers and gas carriers since 1998"
              aria-describedby="tagline-hint"
            />
            <span id="tagline-hint" className={hintClass}>
              One line shown under your name. {TAGLINE_MAX_LENGTH - tagline.length} characters left. Leave empty to use the first line of the description.
            </span>
            {error('tagline') ? <span className="mt-1 block text-xs text-red-700">{error('tagline')}</span> : null}
          </label>

          <label className={labelClass}>
            Company size
            <select name="companySize" defaultValue={workspace.companySize ?? ''} className={inputClass}>
              <option value="">Not shown</option>
              {COMPANY_SIZES.map((size) => <option key={size.value} value={size.value}>{size.label}</option>)}
            </select>
            {error('companySize') ? <span className="mt-1 block text-xs text-red-700">{error('companySize')}</span> : null}
          </label>

          <label className={labelClass}>
            Website
            <input name="website" type="url" maxLength={320} defaultValue={workspace.website ?? ''} className={inputClass} placeholder="https://" />
            {error('website') ? <span className="mt-1 block text-xs text-red-700">{error('website')}</span> : null}
          </label>

          <label className={labelClass + ' sm:col-span-2'}>
            Office locations
            <input name="officeLocations" maxLength={2000} defaultValue={workspace.officeLocations.join(', ')} className={inputClass} placeholder="Mumbai, Singapore" />
            <span className={hintClass}>Separate with commas. The first location is shown as your headquarters.</span>
            {error('officeLocations') ? <span className="mt-1 block text-xs text-red-700">{error('officeLocations')}</span> : null}
          </label>

          <label className={labelClass + ' sm:col-span-2'}>
            Specialities
            <input name="specialties" maxLength={1400} defaultValue={workspace.specialties.join(', ')} className={inputClass} placeholder="Tanker management, Crew training, SIRE 2.0 preparation" />
            <span className={hintClass}>Up to 20, separated with commas.</span>
            {error('specialties') ? <span className="mt-1 block text-xs text-red-700">{error('specialties')}</span> : null}
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
                    <label key={service.value} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-mist-100 px-3 text-sm text-navy-900 hover:bg-mist-50 has-[:checked]:border-teal-300 has-[:checked]:bg-teal-50">
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
                    <label key={value} className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-mist-100 px-3 text-sm text-navy-900 hover:bg-mist-50 has-[:checked]:border-teal-300 has-[:checked]:bg-teal-50">
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
          <button type="submit" disabled={pending} className="min-h-11 cursor-pointer rounded-xl bg-navy-950 px-5 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-wait disabled:opacity-60">
            {pending ? 'Saving…' : 'Save page details'}
          </button>
        </div>
      </section>
    </form>
  )
}
