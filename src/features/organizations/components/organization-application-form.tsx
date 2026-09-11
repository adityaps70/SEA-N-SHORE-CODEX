'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { resubmitOrganizationApplication, submitOrganizationApplication } from '../actions'
import type { OrganizationApplicationInput } from '../repository'

type OrganizationApplicationFormProps =
  | { mode: 'create'; initial?: never; applicationId?: never }
  | { mode: 'resubmit'; applicationId: string; initial: OrganizationApplicationInput }

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-navy-950 outline-none transition placeholder:text-muted focus:border-navy-300 focus:ring-2 focus:ring-navy-100'
const labelClass = 'space-y-1.5 text-sm font-semibold text-navy-900'

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

export function OrganizationApplicationForm(props: OrganizationApplicationFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const initial = props.mode === 'resubmit' ? props.initial : undefined

  function submit(formData: FormData) {
    const input = inputFromForm(formData)
    setMessage(null)
    setIsError(false)

    startTransition(async () => {
      const result = props.mode === 'create'
        ? await submitOrganizationApplication(input)
        : await resubmitOrganizationApplication(props.applicationId, input)

      if (!result.ok) {
        setIsError(true)
        setMessage(result.error)
        return
      }

      setMessage(props.mode === 'create' ? 'Organization submitted for verification.' : 'Organization application resubmitted.')
      router.refresh()
    })
  }

  return (
    <form action={submit} className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Employer identity</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Tell us about your organization</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Sea N Shore reviews every employer before Hiring access is activated.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Organization name
            <input className={inputClass} name="organizationName" defaultValue={initial?.organizationName ?? ''} required />
          </label>
          <label className={labelClass}>
            Organization type
            <input className={inputClass} name="organizationType" defaultValue={initial?.organizationType ?? ''} placeholder="Shipowner, Ship Manager, Crewing Company" required />
          </label>
          <label className={labelClass}>
            Website
            <input className={inputClass} name="website" type="url" defaultValue={initial?.website ?? ''} placeholder="https://company.com" />
          </label>
          <label className={labelClass}>
            Official company email
            <input className={inputClass} name="officialEmail" type="email" defaultValue={initial?.officialEmail ?? ''} required />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Office location
            <input className={inputClass} name="officeLocation" defaultValue={initial?.officeLocation ?? ''} placeholder="Mumbai, India" required />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Description
            <textarea className={`${inputClass} min-h-32`} name="description" defaultValue={initial?.description ?? ''} placeholder="Describe your maritime business, operations and hiring needs." required />
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
            <textarea className={`${inputClass} min-h-24`} name="fleetSummary" defaultValue={initial?.fleetSummary ?? ''} placeholder="Fleet size, managed vessels, operating model or other relevant context." />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Vessel types
            <input className={inputClass} name="vesselTypes" defaultValue={initial?.vesselTypes.join(', ') ?? ''} placeholder="Oil Tanker, Bulk Carrier, LNG" />
            <span className="block text-xs font-normal text-muted">Separate multiple vessel types with commas.</span>
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
            <input className={inputClass} name="applicantRole" defaultValue={initial?.applicantRole ?? ''} placeholder="Director, HR Manager, Crewing Manager" required />
          </label>
          <label className={labelClass}>
            Registration / reference number
            <input className={inputClass} name="registrationReference" defaultValue={initial?.registrationReference ?? ''} placeholder="CIN / registration / RPSL reference" />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Supporting notes
            <textarea className={`${inputClass} min-h-28`} name="supportingNotes" defaultValue={initial?.supportingNotes ?? ''} placeholder="Anything that helps Sea N Shore verify the organization and your authority to represent it." />
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

      {message ? (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${isError ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
          {message}
        </p>
      ) : null}
    </form>
  )
}
