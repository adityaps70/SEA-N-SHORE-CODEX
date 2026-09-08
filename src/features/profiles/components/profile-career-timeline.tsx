'use client'

import { useActionState, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Anchor,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  MapPin,
  Pencil,
  Plus,
  Ship,
  Trash2,
  X,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  createProfileExperience,
  deleteProfileExperience,
  updateProfileExperience,
  type ProfilePortfolioActionState,
} from '../profile-portfolio-actions'
import type { ProfileExperienceRecord, ProfileExperienceTrack } from '../profile-portfolio-types'

const initialActionState: ProfilePortfolioActionState = {}

const trackLabels: Record<ProfileExperienceTrack, string> = {
  sea_service: 'Sea service',
  shore_role: 'Shore role',
  training: 'Training / education',
  other_maritime: 'Other maritime role',
}

function monthYear(value: string | null) {
  if (!value) return null
  const [year, month] = value.split('-')
  if (!year || !month) return value
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1))
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function periodLabel(record: ProfileExperienceRecord) {
  const start = monthYear(record.startedOn)
  const end = record.isCurrent ? 'Present' : monthYear(record.endedOn)
  if (start && end) return `${start} – ${end}`
  return start ?? end ?? null
}

function FieldError({ state, name }: { state: ProfilePortfolioActionState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0]
  return message ? <p className="mt-1 text-xs font-medium text-red-700">{message}</p> : null
}

function ExperienceEditor({
  record,
  onClose,
}: {
  record?: ProfileExperienceRecord
  onClose: () => void
}) {
  const router = useRouter()
  const [track, setTrack] = useState<ProfileExperienceTrack>(record?.track ?? 'sea_service')

  async function submit(previousState: ProfilePortfolioActionState, formData: FormData) {
    const nextState = record
      ? await updateProfileExperience(record.id, previousState, formData)
      : await createProfileExperience(previousState, formData)

    if (nextState.success) {
      onClose()
      router.refresh()
    }
    return nextState
  }

  const [state, formAction, pending] = useActionState(submit, initialActionState)
  const seaService = track === 'sea_service'
  const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none transition focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100'
  const labelClass = 'block text-sm font-semibold text-navy-950'

  return (
    <form action={formAction} className="mt-5 rounded-2xl border border-ocean-100 bg-ocean-50/35 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.13em] text-ocean-700">{record ? 'Edit experience' : 'Add experience'}</p>
          <p className="mt-1 text-sm leading-5 text-muted">The fields change to match sea service, shore work and training roles.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close experience editor" className="grid size-9 shrink-0 place-items-center rounded-full border border-mist-100 bg-white text-muted hover:text-navy-950">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Experience type
          <select
            name="track"
            value={track}
            onChange={(event) => setTrack(event.target.value as ProfileExperienceTrack)}
            className={inputClass}
          >
            <option value="sea_service">Sea service</option>
            <option value="shore_role">Shore role</option>
            <option value="training">Training / education</option>
            <option value="other_maritime">Other maritime role</option>
          </select>
          <FieldError state={state} name="track" />
        </label>

        <label className={labelClass}>
          {seaService ? 'Rank / role' : 'Job title / role'}
          <input name="title" maxLength={160} defaultValue={record?.title ?? ''} className={inputClass} />
          <FieldError state={state} name="title" />
        </label>

        <label className={labelClass}>
          {seaService ? 'Company / ship manager' : 'Organisation / company'}
          <input name="organization" maxLength={180} defaultValue={record?.organization ?? ''} className={inputClass} />
          <FieldError state={state} name="organization" />
        </label>

        {seaService ? (
          <>
            <label className={labelClass}>
              Vessel
              <input name="vessel" maxLength={160} defaultValue={record?.vessel ?? ''} className={inputClass} />
              <FieldError state={state} name="vessel" />
            </label>
            <label className={labelClass}>
              Vessel type
              <input name="vesselType" maxLength={120} defaultValue={record?.vesselType ?? ''} className={inputClass} placeholder="Oil tanker, LNG, bulk carrier…" />
              <FieldError state={state} name="vesselType" />
            </label>
          </>
        ) : (
          <label className={labelClass}>
            Location
            <input name="location" maxLength={160} defaultValue={record?.location ?? ''} className={inputClass} />
            <FieldError state={state} name="location" />
          </label>
        )}

        <label className={labelClass}>
          Start date
          <input name="startedOn" type="date" defaultValue={record?.startedOn ?? ''} className={inputClass} />
          <FieldError state={state} name="startedOn" />
        </label>
        <label className={labelClass}>
          End date
          <input name="endedOn" type="date" defaultValue={record?.endedOn ?? ''} className={inputClass} />
          <FieldError state={state} name="endedOn" />
        </label>

        <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950">
          <input name="isCurrent" type="checkbox" defaultChecked={record?.isCurrent ?? false} />
          I currently hold this role
        </label>

        {seaService ? (
          <>
            <label className={labelClass}>
              Cargo experience
              <input name="cargoExperience" maxLength={2400} defaultValue={record?.cargoExperience.join(', ') ?? ''} className={inputClass} placeholder="Crude oil, CPP, chemicals…" />
              <FieldError state={state} name="cargoExperience" />
            </label>
            <label className={labelClass}>
              Engine experience
              <input name="engineExperience" maxLength={2400} defaultValue={record?.engineExperience.join(', ') ?? ''} className={inputClass} placeholder="MAN B&W, Wärtsilä, Sulzer…" />
              <FieldError state={state} name="engineExperience" />
            </label>
            <label className={labelClass}>
              Trading areas
              <input name="tradingAreas" maxLength={2400} defaultValue={record?.tradingAreas.join(', ') ?? ''} className={inputClass} placeholder="Worldwide, Arabian Gulf, Europe…" />
              <FieldError state={state} name="tradingAreas" />
            </label>
          </>
        ) : null}
      </div>

      <label className={`${labelClass} mt-4`}>
        Description
        <textarea name="description" maxLength={4000} rows={4} defaultValue={record?.description ?? ''} className={`${inputClass} py-3`} />
        <FieldError state={state} name="description" />
      </label>

      {state.error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-mist-100 bg-white px-4 text-sm font-semibold text-navy-950">Cancel</button>
        <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? 'Saving…' : record ? 'Save experience' : 'Add experience'}
        </button>
      </div>
    </form>
  )
}

function ExperienceEntry({
  record,
  editable,
  onEdit,
}: {
  record: ProfileExperienceRecord
  editable: boolean
  onEdit: () => void
}) {
  const router = useRouter()
  const [deleting, startDelete] = useTransition()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const period = periodLabel(record)
  const seaService = record.track === 'sea_service'

  function remove() {
    setDeleteError(null)
    startDelete(async () => {
      const result = await deleteProfileExperience(record.id)
      if (!result.success) {
        setDeleteError(result.error ?? 'We could not delete this experience.')
        return
      }
      router.refresh()
    })
  }

  return (
    <article className="relative pl-8 sm:pl-10">
      <span className="absolute left-[7px] top-1.5 size-3 rounded-full border-2 border-white bg-ocean-600 shadow-[0_0_0_3px_rgba(14,116,144,.13)]" aria-hidden="true" />
      <div className="rounded-2xl border border-mist-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-ocean-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.1em] text-ocean-700">{trackLabels[record.track]}</span>
              {record.isCurrent ? <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800">Current</span> : null}
            </div>
            <h3 className="mt-2 text-lg font-semibold text-navy-950">{record.title}</h3>
            {record.organization ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-ink">
                <Building2 aria-hidden="true" className="size-4 text-ocean-600" />
                {record.organization}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {period ? <span className="inline-flex items-center gap-1.5"><CalendarDays aria-hidden="true" className="size-4" />{period}</span> : null}
              {record.location ? <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden="true" className="size-4" />{record.location}</span> : null}
              {record.vessel ? <span className="inline-flex items-center gap-1.5"><Ship aria-hidden="true" className="size-4" />{record.vessel}</span> : null}
            </div>
          </div>

          {editable ? (
            <div className="flex shrink-0 gap-1">
              <button type="button" onClick={onEdit} aria-label={`Edit ${record.title}`} className="grid size-9 place-items-center rounded-full border border-mist-100 text-muted hover:border-ocean-400 hover:text-ocean-700">
                <Pencil aria-hidden="true" className="size-4" />
              </button>
              <button type="button" onClick={remove} disabled={deleting} aria-label={`Delete ${record.title}`} className="grid size-9 place-items-center rounded-full border border-mist-100 text-muted hover:border-red-200 hover:text-red-700 disabled:opacity-50">
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </div>
          ) : null}
        </div>

        {seaService && (record.vesselType || record.cargoExperience.length || record.engineExperience.length || record.tradingAreas.length) ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {record.vesselType ? <div><p className="text-xs font-semibold uppercase tracking-[.1em] text-muted">Vessel type</p><p className="mt-1 text-sm font-medium text-navy-950">{record.vesselType}</p></div> : null}
            {record.cargoExperience.length ? <div><p className="text-xs font-semibold uppercase tracking-[.1em] text-muted">Cargo</p><div className="mt-1 flex flex-wrap gap-1.5">{record.cargoExperience.map((item) => <span key={item} className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-medium text-navy-900">{item}</span>)}</div></div> : null}
            {record.engineExperience.length ? <div><p className="text-xs font-semibold uppercase tracking-[.1em] text-muted">Engine</p><div className="mt-1 flex flex-wrap gap-1.5">{record.engineExperience.map((item) => <span key={item} className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-medium text-navy-900">{item}</span>)}</div></div> : null}
            {record.tradingAreas.length ? <div><p className="text-xs font-semibold uppercase tracking-[.1em] text-muted">Trading areas</p><div className="mt-1 flex flex-wrap gap-1.5">{record.tradingAreas.map((item) => <span key={item} className="rounded-full bg-ocean-50 px-2.5 py-1 text-xs font-medium text-ocean-800">{item}</span>)}</div></div> : null}
          </div>
        ) : null}

        {record.description ? <p className="mt-4 text-sm leading-6 text-muted">{record.description}</p> : null}
        {deleteError ? <p role="alert" className="mt-3 text-sm font-medium text-red-700">{deleteError}</p> : null}
      </div>
    </article>
  )
}

export function ProfileCareerTimeline({
  experiences,
  editable = false,
}: {
  experiences: ProfileExperienceRecord[]
  editable?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (!editable && experiences.length === 0) return null

  return (
    <Card className="border border-mist-100 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">
            <BriefcaseBusiness aria-hidden="true" className="size-4" />
            Professional history
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-navy-950">Career timeline</h2>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted">Sea service, shore roles and maritime training in one chronological professional record.</p>
        </div>
        {editable && !adding ? (
          <button type="button" onClick={() => { setAdding(true); setEditingId(null) }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white" aria-label="Add experience">
            <Plus aria-hidden="true" className="size-4" />
            Add experience
          </button>
        ) : null}
      </div>

      {adding ? <ExperienceEditor onClose={() => setAdding(false)} /> : null}

      {experiences.length ? (
        <div className="relative mt-6 space-y-4 before:absolute before:bottom-6 before:left-3 before:top-2 before:w-px before:bg-mist-100">
          {experiences.map((record) => (
            editingId === record.id ? (
              <div key={record.id} className="pl-0 sm:pl-2">
                <ExperienceEditor record={record} onClose={() => setEditingId(null)} />
              </div>
            ) : (
              <ExperienceEntry key={record.id} record={record} editable={editable} onEdit={() => { setEditingId(record.id); setAdding(false) }} />
            )
          ))}
        </div>
      ) : editable && !adding ? (
        <div className="mt-6 rounded-2xl border border-dashed border-mist-100 bg-mist-50/50 p-6 text-center">
          <Anchor aria-hidden="true" className="mx-auto size-7 text-ocean-600" />
          <p className="mt-2 text-sm font-semibold text-navy-950">Build your maritime career timeline</p>
          <p className="mt-1 text-sm text-muted">Add sea service, shore positions, training roles and other maritime experience.</p>
        </div>
      ) : null}
    </Card>
  )
}
