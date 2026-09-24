'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FormErrorSummary, focusFirstFormError } from '@/components/ui/form-error-summary'
import { resubmitOrganizationApplication, submitOrganizationApplication } from '../actions'
import type { OrganizationApplicationInput } from '../repository'

type OrganizationApplicationFormProps =
  | { mode: 'create'; initial?: never; applicationId?: never }
  | { mode: 'resubmit'; applicationId: string; initial: OrganizationApplicationInput }

type FieldErrors = Record<string, string[] | undefined>

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-navy-950 outline-none transition placeholder:text-muted focus:border-navy-300 focus:ring-2 focus:ring-navy-100 aria-[invalid=true]:border-red-300 aria-[invalid=true]:focus:ring-red-200'
const labelClass = 'space-y-1.5 text-sm font-semibold text-navy-900'

const fieldLabels: Record<string, string> = {
  organizationName: 'Organization name',
  organizationType: 'Organization type',
  website: 'Website',
  officialEmail: 'Official company email',
  officeLocation: 'Office location',
  description: 'Description',
  fleetSummary: 'Fleet summary',
  vesselTypes: 'Vessel types',
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
  return {
    organizationName: text(formData, 'organizationName'),
    organizationType: text(formData, 'organizationType'),
    website: nullableText(formData, 'website'),
    officialEmail: text(formData, 'officialEmail'),
    officeLocation: text(formData, 'officeLocation'),
    description: text(formData, 'description'),
    fleetSummary: nullableText(formData, 'fleetSummary'),
    vesselTypes: csv(formData, 'vesselTypes'),
    applicantRole: text(formData, 'applicantRole'),
    registrationReference: nullableText(formData, 'registrationReference'),
    supportingNotes: nullableText(formData, 'supportingNotes'),
  }
}

function fieldError(fieldErrors: FieldErrors, name: string) {
  return fieldErrors[name]?.[0]
}

function errorProps(fieldErrors: FieldErrors, name: string) {
  const error = fieldError(fieldErrors, name)
  return {
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? `${name}-error` : undefined,
  } as const
}

function FieldError({ fieldErrors, name }: { fieldErrors: FieldErrors; name: string }) {
  const error = fieldError(fieldErrors, name)
  if (!error) return null
  return <span id={`${name}-error`} className="block text-xs font-medium leading-5 text-red-700">{error}</span>
}

export function OrganizationApplicationForm(props: OrganizationApplicationFormProps) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const initial = props.mode === 'resubmit' ? props.initial : undefined

  useEffect(() => {
    if (!isError) return
    focusFirstFormError(formRef.current)
  }, [fieldErrors, isError, message])

  function submit(formData: FormData) {
    const input = inputFromForm(formData)
    setMessage(null)
    setIsError(false)
    setFieldErrors({})

    startTransition(async () => {
      try {
        const result = props.mode === 'create'
          ? await submitOrganizationApplication(input)
          : await resubmitOrganizationApplication(props.applicationId, input)

        if (!result.ok) {
          setIsError(true)
          setMessage(result.error)
          setFieldErrors(result.fieldErrors ?? {})
          return
        }

        setMessage(props.mode === 'create' ? 'Organization submitted for verification.' : 'Organization application resubmitted.')
        router.refresh()
      } catch {
        setIsError(true)
        setFieldErrors({})
        setMessage('We could not submit this organization step. Check your connection and try again. Your entered information is still here.')
      }
    })
  }

  return (
    <form
      ref={formRef}
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit(new FormData(event.currentTarget))
      }}
    >
      {isError ? (
        <FormErrorSummary error={message} fieldErrors={fieldErrors} fieldLabels={fieldLabels} />
      ) : null}

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Employer identity</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Tell us about your organization</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Sea N Shore reviews every employer before Hiring access is activated.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Organization name
            <input className={inputClass} name="organizationName" maxLength={160} defaultValue={initial?.organizationName ?? ''} required {...errorProps(fieldErrors, 'organizationName')} />
            <FieldError fieldErrors={fieldErrors} name="organizationName" />
          </label>
          <label className={labelClass}>
            Organization type
            <input className={inputClass} name="organizationType" maxLength={160} defaultValue={initial?.organizationType ?? ''} placeholder="Shipowner, Ship Manager, Crewing Company" required {...errorProps(fieldErrors, 'organizationType')} />
            <FieldError fieldErrors={fieldErrors} name="organizationType" />
          </label>
          <label className={labelClass}>
            Website
            <input className={inputClass} name="website" type="url" maxLength={320} defaultValue={initial?.website ?? ''} placeholder="https://company.com" {...errorProps(fieldErrors, 'website')} />
            <FieldError fieldErrors={fieldErrors} name="website" />
          </label>
          <label className={labelClass}>
            Official company email
            <input className={inputClass} name="officialEmail" type="email" maxLength={320} defaultValue={initial?.officialEmail ?? ''} required {...errorProps(fieldErrors, 'officialEmail')} />
            <FieldError fieldErrors={fieldErrors} name="officialEmail" />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Office location
            <input className={inputClass} name="officeLocation" maxLength={240} defaultValue={initial?.officeLocation ?? ''} placeholder="Mumbai, India" required {...errorProps(fieldErrors, 'officeLocation')} />
            <FieldError fieldErrors={fieldErrors} name="officeLocation" />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Description
            <textarea className={`${inputClass} min-h-32`} name="description" maxLength={4000} defaultValue={initial?.description ?? ''} placeholder="Describe your maritime business, operations and hiring needs." required {...errorProps(fieldErrors, 'description')} />
            <FieldError fieldErrors={fieldErrors} name="description" />
          </label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Maritime operations</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Add operational context</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>
            Fleet summary
            <textarea className={`${inputClass} min-h-24`} name="fleetSummary" maxLength={2000} defaultValue={initial?.fleetSummary ?? ''} placeholder="Fleet size, managed vessels, operating model or other relevant context." {...errorProps(fieldErrors, 'fleetSummary')} />
            <FieldError fieldErrors={fieldErrors} name="fleetSummary" />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Vessel types
            <input
              className={inputClass}
              name="vesselTypes"
              maxLength={3650}
              defaultValue={initial?.vesselTypes.join(', ') ?? ''}
              placeholder="Oil Tanker, Bulk Carrier, LNG"
              aria-invalid={Boolean(fieldError(fieldErrors, 'vesselTypes'))}
              aria-describedby={fieldError(fieldErrors, 'vesselTypes') ? 'vesselTypes-error vesselTypes-hint' : 'vesselTypes-hint'}
            />
            <span id="vesselTypes-hint" className="block text-xs font-normal text-muted">Separate multiple vessel types with commas.</span>
            <FieldError fieldErrors={fieldErrors} name="vesselTypes" />
          </label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Verification context</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Help us verify your relationship</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Your role / relationship
            <input className={inputClass} name="applicantRole" maxLength={160} defaultValue={initial?.applicantRole ?? ''} placeholder="Director, HR Manager, Crewing Manager" required {...errorProps(fieldErrors, 'applicantRole')} />
            <FieldError fieldErrors={fieldErrors} name="applicantRole" />
          </label>
          <label className={labelClass}>
            Registration / reference number
            <input className={inputClass} name="registrationReference" maxLength={160} defaultValue={initial?.registrationReference ?? ''} placeholder="CIN / registration / RPSL reference" {...errorProps(fieldErrors, 'registrationReference')} />
            <FieldError fieldErrors={fieldErrors} name="registrationReference" />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Supporting notes
            <textarea className={`${inputClass} min-h-28`} name="supportingNotes" maxLength={4000} defaultValue={initial?.supportingNotes ?? ''} placeholder="Anything that helps Sea N Shore verify the organization and your authority to represent it." {...errorProps(fieldErrors, 'supportingNotes')} />
            <FieldError fieldErrors={fieldErrors} name="supportingNotes" />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="font-bold text-navy-950">Platform review required</p>
          <p className="mt-1 text-sm text-muted">Posting jobs remains locked until Sea N Shore approves the organization.</p>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Submitting…' : props.mode === 'create' ? 'Submit for verification' : 'Update application & resubmit'}
        </button>
      </section>

      {message && !isError ? (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
    </form>
  )
}
