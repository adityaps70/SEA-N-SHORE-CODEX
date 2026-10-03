'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { FormErrorSummary, focusFirstFormError } from '@/components/ui/form-error-summary'
import { organizationReturnHref, type OrganizationReturnPath } from '@/features/profiles/organization-link'
import { resubmitOrganizationApplication, submitOrganizationApplication } from '../actions'
import { submitOrganizationClaim } from '../unclaimed-organization-actions'
import {
  WELLBEING_SERVICES,
  getOrganizationType,
  isOrganizationTypeCode,
  organizationTypeGroups,
  organizationTypeHasField,
  organizationTypeRequiresField,
  organizationVerificationChecks,
  type OrganizationTypeCode,
  type OrganizationTypeField,
} from '../organization-types'
import type { OrganizationApplicationInput } from '../types'

type OrganizationApplicationFormProps =
  | {
      mode: 'create'
      initial?: never
      applicationId?: never
      onCancel?: () => void
      prefillName?: string
      /** Send the member back here after submitting, with the new organization to link. */
      returnTo?: OrganizationReturnPath | null
    }
  | { mode: 'resubmit'; applicationId: string; initial: OrganizationApplicationInput; onCancel?: never }
  /** Claim an existing unclaimed page: the same verification review as registering. */
  | { mode: 'claim'; companyId: string; initial: OrganizationApplicationInput; applicationId?: never; onCancel?: never }

type FieldErrors = Record<string, string[] | undefined>

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm font-normal text-navy-950 outline-none transition placeholder:text-muted focus:border-navy-300 focus:ring-2 focus:ring-navy-100 aria-[invalid=true]:border-red-300 aria-[invalid=true]:focus:ring-red-200'
const labelClass = 'space-y-1.5 text-sm font-semibold text-navy-900'
const sectionClass = 'rounded-xl border border-mist-100 bg-white p-4 sm:p-5'
const TYPE_GROUPS = organizationTypeGroups()

const fieldLabels: Record<string, string> = {
  organizationName: 'Organization name',
  organizationType: 'Organization type',
  organizationTypeOther: 'Describe the type',
  website: 'Website',
  officialEmail: 'Official work email',
  officeLocation: 'Office location',
  description: 'Description',
  fleetSize: 'Number of vessels',
  fleetSummary: 'Fleet summary',
  vesselTypes: 'Vessel types',
  recruitmentLicence: 'Recruitment licence',
  servicesOffered: 'Services offered',
  languages: 'Languages',
  helpline24x7: '24/7 helpline',
  accreditation: 'Accreditation',
  applicantRole: 'Your role / relationship',
  registrationReference: 'Registration / reference number',
  supportingNotes: 'Supporting notes',
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
}

function nullableText(formData: FormData, key: string) {
  const value = text(formData, key)
  return value || null
}

function csv(formData: FormData, key: string) {
  const seen = new Set<string>()
  return text(formData, key).split(',').flatMap((entry) => {
    const item = entry.trim()
    const normalized = item.toLocaleLowerCase('en')
    if (!item || seen.has(normalized)) return []
    seen.add(normalized)
    return [item]
  })
}

function inputFromForm(formData: FormData): OrganizationApplicationInput {
  const fleetSize = text(formData, 'fleetSize').replace(/,/g, '')
  const helpline = formData.get('helpline24x7')
  return {
    organizationName: text(formData, 'organizationName'),
    organizationType: text(formData, 'organizationType'),
    organizationTypeOther: nullableText(formData, 'organizationTypeOther'),
    website: nullableText(formData, 'website'),
    officialEmail: text(formData, 'officialEmail'),
    officeLocation: text(formData, 'officeLocation'),
    description: text(formData, 'description'),
    fleetSize: fleetSize ? Number(fleetSize) : null,
    fleetSummary: nullableText(formData, 'fleetSummary'),
    vesselTypes: csv(formData, 'vesselTypes'),
    recruitmentLicence: nullableText(formData, 'recruitmentLicence'),
    servicesOffered: formData.getAll('servicesOffered').map(String),
    languages: csv(formData, 'languages'),
    helpline24x7: helpline === 'yes' ? true : helpline === 'no' ? false : null,
    accreditation: nullableText(formData, 'accreditation'),
    applicantRole: text(formData, 'applicantRole'),
    registrationReference: nullableText(formData, 'registrationReference'),
    supportingNotes: nullableText(formData, 'supportingNotes'),
  }
}

function fieldError(fieldErrors: FieldErrors, name: string) {
  return fieldErrors[name]?.[0]
}

function describedBy(fieldErrors: FieldErrors, name: string, hintId?: string) {
  const ids = [fieldError(fieldErrors, name) ? `${name}-error` : null, hintId].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
}

function errorProps(fieldErrors: FieldErrors, name: string, hintId?: string) {
  return {
    'aria-invalid': Boolean(fieldError(fieldErrors, name)),
    'aria-describedby': describedBy(fieldErrors, name, hintId),
  } as const
}

function FieldError({ fieldErrors, name }: { fieldErrors: FieldErrors; name: string }) {
  const error = fieldError(fieldErrors, name)
  if (!error) return null
  return <span id={`${name}-error`} className="block text-xs font-medium leading-5 text-red-700">{error}</span>
}

function Optional() {
  return <span className="font-normal text-muted"> (optional)</span>
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-base font-bold text-navy-950">{title}</h3>
      {description ? <p className="mt-0.5 text-sm leading-6 text-muted">{description}</p> : null}
    </div>
  )
}

export function OrganizationApplicationForm(props: OrganizationApplicationFormProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const initial = props.mode === 'create' ? undefined : props.initial
  const [typeCode, setTypeCode] = useState<OrganizationTypeCode | ''>(
    initial && isOrganizationTypeCode(initial.organizationType) ? initial.organizationType : '',
  )
  const type = typeCode ? getOrganizationType(typeCode) : null

  useEffect(() => {
    if (!isError) return
    focusFirstFormError(formRef.current)
  }, [fieldErrors, isError, message])

  const has = (field: OrganizationTypeField) => Boolean(typeCode && organizationTypeHasField(typeCode, field))
  const requires = (field: OrganizationTypeField) => Boolean(typeCode && organizationTypeRequiresField(typeCode, field))
  const hasFleetFields = has('fleetSize') || has('vesselTypes') || has('fleetSummary') || has('recruitmentLicence')
  const hasWellbeingFields = has('servicesOffered') || has('languages') || has('helpline24x7')
  const fleetSummaryLabel = has('fleetSize') ? 'Fleet summary' : 'Operations summary'

  function submit(formData: FormData) {
    const input = inputFromForm(formData)
    setMessage(null)
    setIsError(false)
    setFieldErrors({})

    startTransition(async () => {
      try {
        const result = props.mode === 'create'
          ? await submitOrganizationApplication(input)
          : props.mode === 'claim'
            ? await submitOrganizationClaim(props.companyId, input)
            : await resubmitOrganizationApplication(props.applicationId, input)

        if (!result.ok) {
          setIsError(true)
          setMessage(result.error)
          setFieldErrors(result.fieldErrors ?? {})
          return
        }

        const companyId = 'companyId' in result && typeof result.companyId === 'string' ? result.companyId : null
        if (props.mode === 'create' && props.returnTo && companyId) {
          setMessage('Organization submitted. Sea N Shore will review it. Taking you back…')
          router.push(organizationReturnHref(props.returnTo, companyId))
          return
        }

        setMessage(props.mode === 'create'
          ? 'Organization submitted. Sea N Shore will review it and you will see the result on this page.'
          : props.mode === 'claim'
            ? 'Claim sent. Sea N Shore will review it and you will see the result on your Organizations page.'
            : 'Changes sent. Sea N Shore will review the updated details.')
        router.refresh()
      } catch {
        setIsError(true)
        setFieldErrors({})
        setMessage('We could not submit this organization. Check your connection and try again. Your entered information is still here.')
      }
    })
  }

  return (
    <form
      ref={formRef}
      className="space-y-4"
      noValidate
      aria-label={props.mode === 'create' ? 'Register a new organization' : props.mode === 'claim' ? 'Claim organization page' : 'Update organization application'}
      onSubmit={(event) => {
        event.preventDefault()
        submit(new FormData(event.currentTarget))
      }}
    >
      {isError ? (
        <FormErrorSummary
          // The summary already says to correct the highlighted fields; repeat the server message only when no field is named.
          error={Object.values(fieldErrors).some((messages) => messages?.length) ? null : message}
          fieldErrors={fieldErrors}
          fieldLabels={fieldLabels}
        />
      ) : null}

      <section className={sectionClass}>
        <SectionHeading title="Organization type" description="Choose the closest match. The form adapts to show what matters for that type." />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={`${labelClass} sm:col-span-2`}>
            <label htmlFor="org-organizationType" className="block">Organization type</label>
            <select id="org-organizationType"
              className={inputClass}
              name="organizationType"
              value={typeCode}
              onChange={(event) => setTypeCode(isOrganizationTypeCode(event.target.value) ? event.target.value : '')}
              required
              {...errorProps(fieldErrors, 'organizationType', type ? 'organizationType-hint' : undefined)}
            >
              <option value="">Choose a type…</option>
              {TYPE_GROUPS.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {group.types.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
                </optgroup>
              ))}
            </select>
            {type ? <span id="organizationType-hint" className="block text-xs font-normal text-muted">{type.hint}</span> : null}
            <FieldError fieldErrors={fieldErrors} name="organizationType" />
          </div>
          {typeCode === 'other' ? (
            <div className={`${labelClass} sm:col-span-2`}>
              <label htmlFor="org-organizationTypeOther" className="block">Describe the type</label>
              <input id="org-organizationTypeOther" className={inputClass} name="organizationTypeOther" maxLength={160} defaultValue={initial?.organizationTypeOther ?? ''} placeholder="For example: Seafarer family network" required {...errorProps(fieldErrors, 'organizationTypeOther')} />
              <FieldError fieldErrors={fieldErrors} name="organizationTypeOther" />
            </div>
          ) : null}
        </div>
      </section>

      <section className={sectionClass}>
        <SectionHeading title="About the organization" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={labelClass}>
            <label htmlFor="org-organizationName" className="block">Organization name</label>
            <input id="org-organizationName" className={inputClass} name="organizationName" maxLength={160} defaultValue={initial?.organizationName ?? (props.mode === 'create' ? props.prefillName ?? '' : '')} required {...errorProps(fieldErrors, 'organizationName')} />
            <FieldError fieldErrors={fieldErrors} name="organizationName" />
          </div>
          <div className={labelClass}>
            <label htmlFor="org-website" className="block"><span>Website<Optional /></span></label>
            <input id="org-website" className={inputClass} name="website" type="url" maxLength={320} defaultValue={initial?.website ?? ''} placeholder="https://example.org" {...errorProps(fieldErrors, 'website')} />
            <FieldError fieldErrors={fieldErrors} name="website" />
          </div>
          <div className={labelClass}>
            <label htmlFor="org-officialEmail" className="block">Official work email</label>
            <input id="org-officialEmail" className={inputClass} name="officialEmail" type="email" maxLength={320} defaultValue={initial?.officialEmail ?? ''} placeholder="name@your-organization.org" required {...errorProps(fieldErrors, 'officialEmail', 'officialEmail-hint')} />
            <span id="officialEmail-hint" className="block text-xs font-normal text-muted">Use an address on your organization&apos;s own domain where you can.</span>
            <FieldError fieldErrors={fieldErrors} name="officialEmail" />
          </div>
          <div className={labelClass}>
            <label htmlFor="org-officeLocation" className="block">Office location</label>
            <input id="org-officeLocation" className={inputClass} name="officeLocation" maxLength={240} defaultValue={initial?.officeLocation ?? ''} placeholder="Mumbai, India" required {...errorProps(fieldErrors, 'officeLocation')} />
            <FieldError fieldErrors={fieldErrors} name="officeLocation" />
          </div>
          <div className={`${labelClass} sm:col-span-2`}>
            <label htmlFor="org-description" className="block">Description</label>
            <textarea id="org-description" className={`${inputClass} min-h-28`} name="description" maxLength={4000} defaultValue={initial?.description ?? ''} placeholder={type?.descriptionPlaceholder ?? 'What your organization does and who it works with.'} required {...errorProps(fieldErrors, 'description')} />
            <FieldError fieldErrors={fieldErrors} name="description" />
          </div>
        </div>
      </section>

      {/* Type-specific sections stay mounted while hidden so switching type does not lose entries.
          The server keeps only the fields that apply to the chosen type. */}
      <section className={sectionClass} hidden={!hasFleetFields}>
        <SectionHeading title={has('recruitmentLicence') && !has('fleetSize') ? 'Recruitment & operations' : 'Fleet & operations'} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={labelClass} hidden={!has('recruitmentLicence')}>
            <label htmlFor="org-recruitmentLicence" className="block"><span>Recruitment licence{requires('recruitmentLicence') ? null : <Optional />}</span></label>
            <input id="org-recruitmentLicence" className={inputClass} name="recruitmentLicence" maxLength={120} defaultValue={initial?.recruitmentLicence ?? ''} placeholder="RPSL number or MLC 2006 certificate number" {...errorProps(fieldErrors, 'recruitmentLicence', 'recruitmentLicence-hint')} />
            <span id="recruitmentLicence-hint" className="block text-xs font-normal text-muted">RPSL licence (India) or your MLC 2006 recruitment and placement certificate.</span>
            <FieldError fieldErrors={fieldErrors} name="recruitmentLicence" />
          </div>
          <div className={labelClass} hidden={!has('fleetSize')}>
            <label htmlFor="org-fleetSize" className="block"><span>Number of vessels<Optional /></span></label>
            <input id="org-fleetSize" className={inputClass} name="fleetSize" inputMode="numeric" maxLength={6} defaultValue={initial?.fleetSize ?? ''} placeholder="12" {...errorProps(fieldErrors, 'fleetSize')} />
            <FieldError fieldErrors={fieldErrors} name="fleetSize" />
          </div>
          <div className={`${labelClass} sm:col-span-2`} hidden={!has('vesselTypes')}>
            <label htmlFor="org-vesselTypes" className="block"><span>Vessel types<Optional /></span></label>
            <input id="org-vesselTypes"
              className={inputClass}
              name="vesselTypes"
              maxLength={3650}
              defaultValue={initial?.vesselTypes.join(', ') ?? ''}
              placeholder="Oil Tanker, Bulk Carrier, LNG"
              {...errorProps(fieldErrors, 'vesselTypes', 'vesselTypes-hint')}
            />
            <span id="vesselTypes-hint" className="block text-xs font-normal text-muted">Separate multiple vessel types with commas.</span>
            <FieldError fieldErrors={fieldErrors} name="vesselTypes" />
          </div>
          <div className={`${labelClass} sm:col-span-2`} hidden={!has('fleetSummary')}>
            <label htmlFor="org-fleetSummary" className="block"><span>{fleetSummaryLabel}<Optional /></span></label>
            <textarea id="org-fleetSummary" className={`${inputClass} min-h-20`} name="fleetSummary" maxLength={2000} defaultValue={initial?.fleetSummary ?? ''} placeholder="Managed vessels, trading areas, operating model or other useful context." {...errorProps(fieldErrors, 'fleetSummary')} />
            <FieldError fieldErrors={fieldErrors} name="fleetSummary" />
          </div>
        </div>
      </section>

      <section className={sectionClass} hidden={!hasWellbeingFields}>
        <SectionHeading title="Support services" description="Shown on your organization page so seafarers and families know how you can help." />
        <div className="grid gap-4">
          <fieldset className="space-y-2" aria-describedby={describedBy(fieldErrors, 'servicesOffered')}>
            <legend className="text-sm font-semibold text-navy-900">Services offered{requires('servicesOffered') ? null : <Optional />}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {WELLBEING_SERVICES.map((service, index) => (
                <label key={service.value} className="flex min-h-10 items-center gap-2 rounded-lg border border-mist-100 px-3 text-sm text-navy-900 has-[:checked]:border-teal-300 has-[:checked]:bg-teal-50">
                  <input
                    type="checkbox"
                    name="servicesOffered"
                    value={service.value}
                    defaultChecked={initial?.servicesOffered?.includes(service.value) ?? false}
                    aria-invalid={index === 0 && Boolean(fieldError(fieldErrors, 'servicesOffered'))}
                    className="size-4 accent-teal-700"
                  />
                  {service.label}
                </label>
              ))}
            </div>
            <FieldError fieldErrors={fieldErrors} name="servicesOffered" />
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className={labelClass}>
              <label htmlFor="org-languages" className="block"><span>Languages{requires('languages') ? null : <Optional />}</span></label>
              <input id="org-languages" className={inputClass} name="languages" maxLength={600} defaultValue={initial?.languages?.join(', ') ?? ''} placeholder="English, Hindi, Tagalog" {...errorProps(fieldErrors, 'languages', 'languages-hint')} />
              <span id="languages-hint" className="block text-xs font-normal text-muted">Languages people can get support in, separated by commas.</span>
              <FieldError fieldErrors={fieldErrors} name="languages" />
            </div>

            <fieldset className="space-y-1.5" aria-describedby={describedBy(fieldErrors, 'helpline24x7')}>
              <legend className="text-sm font-semibold text-navy-900">Do you run a 24/7 helpline?{requires('helpline24x7') ? null : <Optional />}</legend>
              <div className="flex gap-2">
                {(['yes', 'no'] as const).map((value, index) => (
                  <label key={value} className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-mist-100 px-3 text-sm text-navy-900 has-[:checked]:border-teal-300 has-[:checked]:bg-teal-50">
                    <input
                      type="radio"
                      name="helpline24x7"
                      value={value}
                      defaultChecked={initial?.helpline24x7 === (value === 'yes')}
                      data-form-error-target={index === 0 && fieldError(fieldErrors, 'helpline24x7') ? 'true' : undefined}
                      className="size-4 accent-teal-700"
                    />
                    {value === 'yes' ? 'Yes, 24/7' : 'No'}
                  </label>
                ))}
              </div>
              <FieldError fieldErrors={fieldErrors} name="helpline24x7" />
            </fieldset>
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <SectionHeading title="Verification" description="Sea N Shore checks every organization before its workspace is verified." />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={`${labelClass} sm:col-span-2`} hidden={!has('accreditation')}>
            <label htmlFor="org-accreditation" className="block"><span>{type?.accreditationLabel ?? 'Accreditation'}{requires('accreditation') ? null : <Optional />}</span></label>
            <input id="org-accreditation" className={inputClass} name="accreditation" maxLength={240} defaultValue={initial?.accreditation ?? ''} placeholder={type?.accreditationPlaceholder ?? ''} {...errorProps(fieldErrors, 'accreditation')} />
            <FieldError fieldErrors={fieldErrors} name="accreditation" />
          </div>
          <div className={labelClass}>
            <label htmlFor="org-applicantRole" className="block">Your role / relationship</label>
            <input id="org-applicantRole" className={inputClass} name="applicantRole" maxLength={160} defaultValue={initial?.applicantRole ?? ''} placeholder={type?.applicantRolePlaceholder ?? 'Director, HR Manager, Service Lead'} required {...errorProps(fieldErrors, 'applicantRole')} />
            <FieldError fieldErrors={fieldErrors} name="applicantRole" />
          </div>
          <div className={labelClass}>
            {/* Default label: Registration / reference number */}
            <label htmlFor="org-registrationReference" className="block">{type?.registrationLabel ?? 'Registration / reference number'}<Optional /></label>
            <input id="org-registrationReference" className={inputClass} name="registrationReference" maxLength={160} defaultValue={initial?.registrationReference ?? ''} placeholder={type?.registrationPlaceholder ?? 'Company, charity or registration number'} {...errorProps(fieldErrors, 'registrationReference')} />
            <FieldError fieldErrors={fieldErrors} name="registrationReference" />
          </div>
          <div className={`${labelClass} sm:col-span-2`}>
            <label htmlFor="org-supportingNotes" className="block"><span>Supporting notes<Optional /></span></label>
            <textarea id="org-supportingNotes" className={`${inputClass} min-h-20`} name="supportingNotes" maxLength={4000} defaultValue={initial?.supportingNotes ?? ''} placeholder="Anything that helps Sea N Shore confirm the organization and your authority to represent it." {...errorProps(fieldErrors, 'supportingNotes')} />
            <FieldError fieldErrors={fieldErrors} name="supportingNotes" />
          </div>
        </div>

        {typeCode ? (
          <div className="mt-4 rounded-lg border border-ocean-100 bg-ocean-50/50 p-3" data-testid="verification-checks">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-navy-950">
              <ShieldCheck aria-hidden="true" className="size-4 text-ocean-700" />
              What Sea N Shore checks for a {getOrganizationType(typeCode).label.toLowerCase()}
            </p>
            <ul className="mt-2 space-y-1 text-sm leading-6 text-navy-900">
              {organizationVerificationChecks(typeCode).map((check) => (
                <li key={check} className="flex gap-2"><CheckCircle2 aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-ocean-700" />{check}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {props.mode === 'create' && props.onCancel ? (
          <button type="button" onClick={props.onCancel} className="min-h-11 rounded-xl border border-mist-200 bg-white px-5 text-sm font-bold text-navy-950 transition hover:bg-mist-50">
            Cancel
          </button>
        ) : null}
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Submitting…' : props.mode === 'create' ? 'Submit for verification' : props.mode === 'claim' ? 'Send claim for verification' : 'Update application & resubmit'}
        </button>
      </div>

      {message && !isError ? (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
    </form>
  )
}
