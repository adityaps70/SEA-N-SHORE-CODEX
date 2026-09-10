'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createHiringJob, updateHiringJob } from '../hiring-actions'
import type { HiringEditableJob, HiringJobInput, HiringJobUpdateInput } from '../hiring-repository'

type HiringJobFormProps =
  | { mode: 'create'; companyId: string; initial?: never; jobId?: never }
  | { mode: 'edit'; jobId: string; initial: HiringEditableJob; companyId?: never }

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-navy-950 outline-none transition placeholder:text-muted focus:border-navy-300 focus:ring-2 focus:ring-navy-100'
const labelClass = 'space-y-1.5 text-sm font-semibold text-navy-900'

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
}

function nullableText(formData: FormData, key: string) {
  const value = text(formData, key)
  return value || null
}

function nullableNumber(formData: FormData, key: string) {
  const value = text(formData, key)
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function csv(formData: FormData, key: string) {
  return [...new Set(text(formData, key).split(',').map((item) => item.trim()).filter(Boolean))]
}

function buildInput(formData: FormData): HiringJobUpdateInput {
  const domainValue = text(formData, 'domain')
  const salaryPeriodValue = text(formData, 'salaryPeriod')
  const statusValue = text(formData, 'status')

  return {
    title: text(formData, 'title'),
    domain: domainValue === 'shore' ? 'shore' : 'sea',
    department: nullableText(formData, 'department'),
    rank: nullableText(formData, 'rank'),
    vesselTypes: csv(formData, 'vesselTypes'),
    location: nullableText(formData, 'location'),
    regions: csv(formData, 'regions'),
    summary: text(formData, 'summary'),
    description: text(formData, 'description'),
    requirements: nullableText(formData, 'requirements'),
    experienceMinYears: nullableNumber(formData, 'experienceMinYears'),
    experienceMaxYears: nullableNumber(formData, 'experienceMaxYears'),
    joiningFrom: nullableText(formData, 'joiningFrom'),
    joiningUntil: nullableText(formData, 'joiningUntil'),
    salaryMin: nullableNumber(formData, 'salaryMin'),
    salaryMax: nullableNumber(formData, 'salaryMax'),
    salaryCurrency: nullableText(formData, 'salaryCurrency'),
    salaryPeriod: salaryPeriodValue === 'day' || salaryPeriodValue === 'year' || salaryPeriodValue === 'month' ? salaryPeriodValue : null,
    urgent: formData.get('urgent') === 'on',
    easyApply: formData.get('easyApply') === 'on',
    applyUntil: nullableText(formData, 'applyUntil'),
    status: statusValue === 'published' ? 'published' : 'draft',
    certificates: csv(formData, 'certificates'),
    visas: csv(formData, 'visas'),
  }
}

function join(values: string[] | undefined) {
  return values?.join(', ') ?? ''
}

export function HiringJobForm(props: HiringJobFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const initial = props.mode === 'edit' ? props.initial : undefined

  function submit(formData: FormData) {
    setMessage(null)
    setIsError(false)
    const fields = buildInput(formData)

    startTransition(async () => {
      const result = props.mode === 'create'
        ? await createHiringJob({ companyId: props.companyId, ...fields } satisfies HiringJobInput)
        : await updateHiringJob(props.jobId, fields)

      if (!result.ok) {
        setIsError(true)
        setMessage(result.error)
        return
      }

      setMessage(props.mode === 'create' ? 'Job saved successfully.' : 'Changes saved successfully.')
      if (props.mode === 'create') {
        router.push('/hiring/jobs')
      } else {
        router.refresh()
      }
    })
  }

  return (
    <form action={submit} className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Role</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Describe the opportunity</h2>
          <p className="mt-1 text-sm text-muted">Use structured maritime fields so the right professionals can be matched to this vacancy.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>
            Job title
            <input className={inputClass} name="title" defaultValue={initial?.title ?? ''} placeholder="Chief Officer" required />
          </label>

          <label className={labelClass}>
            Job type
            <select className={inputClass} name="domain" defaultValue={initial?.domain ?? 'sea'}>
              <option value="sea">Sea job</option>
              <option value="shore">Shore job</option>
            </select>
          </label>

          <label className={labelClass}>
            Department
            <input className={inputClass} name="department" defaultValue={initial?.department ?? ''} placeholder="Deck, Engine, QHSE" />
          </label>

          <label className={labelClass}>
            Rank / position
            <input className={inputClass} name="rank" defaultValue={initial?.rank ?? ''} placeholder="Chief Officer" />
          </label>

          <label className={labelClass}>
            Location
            <input className={inputClass} name="location" defaultValue={initial?.location ?? ''} placeholder="Worldwide / Mumbai / Dubai" />
          </label>

          <label className={`${labelClass} sm:col-span-2`}>
            Summary
            <textarea className={`${inputClass} min-h-24`} name="summary" defaultValue={initial?.summary ?? ''} placeholder="A concise overview candidates will see first." required />
          </label>

          <label className={`${labelClass} sm:col-span-2`}>
            Description
            <textarea className={`${inputClass} min-h-40`} name="description" defaultValue={initial?.description ?? ''} placeholder="Responsibilities, contract details and role context." required />
          </label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Maritime requirements</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Define the professional fit</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>
            Vessel types
            <input className={inputClass} name="vesselTypes" defaultValue={join(initial?.vesselTypes)} placeholder="Oil Tanker, Chemical Tanker" />
            <span className="block text-xs font-normal text-muted">Separate multiple values with commas.</span>
          </label>

          <fieldset className="rounded-xl border border-mist-100 p-4 sm:col-span-2">
            <legend className="px-1 text-sm font-semibold text-navy-900">Experience</legend>
            <div className="mt-1 grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Minimum years
                <input className={inputClass} type="number" min="0" step="0.5" name="experienceMinYears" defaultValue={initial?.experienceMinYears ?? ''} />
              </label>
              <label className={labelClass}>
                Maximum years
                <input className={inputClass} type="number" min="0" step="0.5" name="experienceMaxYears" defaultValue={initial?.experienceMaxYears ?? ''} />
              </label>
            </div>
          </fieldset>

          <label className={`${labelClass} sm:col-span-2`}>
            Sailing regions
            <input className={inputClass} name="regions" defaultValue={join(initial?.regions)} placeholder="Worldwide, Middle East, Europe" />
          </label>

          <label className={labelClass}>
            Certificates
            <input className={inputClass} name="certificates" defaultValue={join(initial?.certificates)} placeholder="STCW, Advanced Oil Tanker" />
          </label>

          <label className={labelClass}>
            Visas
            <input className={inputClass} name="visas" defaultValue={join(initial?.visas)} placeholder="US C1/D, Schengen" />
          </label>

          <label className={`${labelClass} sm:col-span-2`}>
            Other requirements
            <textarea className={`${inputClass} min-h-28`} name="requirements" defaultValue={initial?.requirements ?? ''} placeholder="Additional eligibility, vessel or contract requirements." />
          </label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Joining & compensation</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Set timing and Salary</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            Joining from
            <input className={inputClass} type="date" name="joiningFrom" defaultValue={initial?.joiningFrom ?? ''} />
          </label>
          <label className={labelClass}>
            Joining until
            <input className={inputClass} type="date" name="joiningUntil" defaultValue={initial?.joiningUntil ?? ''} />
          </label>
          <label className={labelClass}>
            Apply until
            <input className={inputClass} type="date" name="applyUntil" defaultValue={initial?.applyUntil ?? ''} />
          </label>
          <div className="hidden lg:block" />

          <label className={labelClass}>
            Salary minimum
            <input className={inputClass} type="number" min="0" step="1" name="salaryMin" defaultValue={initial?.salaryMin ?? ''} />
          </label>
          <label className={labelClass}>
            Salary maximum
            <input className={inputClass} type="number" min="0" step="1" name="salaryMax" defaultValue={initial?.salaryMax ?? ''} />
          </label>
          <label className={labelClass}>
            Currency
            <input className={inputClass} name="salaryCurrency" defaultValue={initial?.salaryCurrency ?? 'USD'} placeholder="USD" />
          </label>
          <label className={labelClass}>
            Salary period
            <select className={inputClass} name="salaryPeriod" defaultValue={initial?.salaryPeriod ?? 'month'}>
              <option value="month">Per month</option>
              <option value="day">Per day</option>
              <option value="year">Per year</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Publishing</p>
            <h2 className="mt-1 text-xl font-bold text-navy-950">Control how candidates see this role</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-mist-100 px-3 py-2 text-sm font-medium text-navy-900">
                <input type="checkbox" name="urgent" defaultChecked={initial?.urgent ?? false} />
                Urgent joining
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-mist-100 px-3 py-2 text-sm font-medium text-navy-900">
                <input type="checkbox" name="easyApply" defaultChecked={initial?.easyApply ?? true} />
                Easy Apply
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
                Status
                <select className={`${inputClass} min-h-10 w-auto`} name="status" defaultValue={initial?.status ?? 'draft'}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="min-h-11 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? 'Saving…' : props.mode === 'create' ? 'Create job' : 'Save changes'}
          </button>
        </div>

        {message ? (
          <p role="status" className={`mt-4 rounded-xl px-3 py-2 text-sm ${isError ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
            {message}
          </p>
        ) : null}
      </section>
    </form>
  )
}
