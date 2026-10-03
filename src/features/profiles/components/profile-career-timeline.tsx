'use client'

import { useActionState, useState, useTransition } from 'react'
import {
  Briefcase,
  Building2,
  CalendarDays,
  MapPin,
  Pencil,
  Plus,
  Ship,
} from 'lucide-react'
import type { Persona } from '../persona'
import {
  createProfileExperience,
  deleteProfileExperience,
  updateProfileExperience,
  type ProfilePortfolioActionState,
} from '../profile-portfolio-actions'
import {
  defaultExperienceTrackForPersona,
  EXPERIENCE_TRACK_LABELS,
  experienceTracksForPersona,
} from '../profile-persona-rules'
import type { ProfileExperienceRecord, ProfileExperienceTrack } from '../profile-portfolio-types'
import { ProfileCardFieldError, ProfileCardForm, profileCardLabelClass, useProfileCardEditor } from './profile-card-editing'
import { PHONE_ICON_ADD_BUTTON_CLASS, ProfileSection } from './profile-section'
import { PhoneShowAll } from './profile-show-all'

const initialActionState: ProfilePortfolioActionState = {}

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

/** Field labels follow the experience type (round 11). */
function trackFieldLabels(track: ProfileExperienceTrack) {
  if (track === 'sea_service') {
    return { title: 'Rank / role', organization: 'Company / ship manager', current: 'I currently hold this role' }
  }
  if (track === 'training') {
    return { title: 'Course / programme', organization: 'Institute', current: 'I am still on this course' }
  }
  return { title: 'Job title', organization: 'Organization', current: 'I work here now' }
}

const itemPencilClass = 'grid size-9 shrink-0 place-items-center rounded-full border border-mist-200 text-muted transition-colors hover:border-ocean-400 hover:text-ocean-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600 max-md:size-11 max-md:border-transparent'

/**
 * One experience item's in-place form (add or edit). Editing an item also offers Delete, confirmed
 * in place. Sea service, with its vessel fields, is offered to seafarers and cadets, and kept for
 * a record that already is sea service, so nothing saved is hidden.
 */
function ExperienceEditor({
  cardId,
  record,
  persona,
  onClose,
  onDirty,
}: {
  cardId: string
  record?: ProfileExperienceRecord
  persona: Persona | null
  onClose: () => void
  onDirty: () => void
}) {
  const tracks: ProfileExperienceTrack[] = persona
    ? experienceTracksForPersona(persona, record?.track)
    : ['sea_service', 'shore_role', 'training', 'other_maritime']
  const [track, setTrack] = useState<ProfileExperienceTrack>(record?.track ?? (persona ? defaultExperienceTrackForPersona(persona) : 'sea_service'))
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, startDelete] = useTransition()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function submit(previousState: ProfilePortfolioActionState, formData: FormData) {
    const nextState = record
      ? await updateProfileExperience(record.id, previousState, formData)
      : await createProfileExperience(previousState, formData)

    if (nextState.success) onClose()
    return nextState
  }

  function remove() {
    if (!record) return
    setDeleteError(null)
    startDelete(async () => {
      const result = await deleteProfileExperience(record.id)
      if (result.success) onClose()
      else setDeleteError(result.error ?? 'We could not delete this experience.')
    })
  }

  const [state, formAction, pending] = useActionState(submit, initialActionState)
  const busy = pending || deleting
  const seaService = track === 'sea_service'
  const labels = trackFieldLabels(track)
  // Training shows course, institute, dates and description; a location saved earlier stays editable.
  const showLocation = !seaService && (track !== 'training' || Boolean(record?.location))
  const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none transition focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100'
  const labelClass = profileCardLabelClass
  const errors = state.fieldErrors

  return (
    <ProfileCardForm
      cardId={cardId}
      label={record ? `Edit ${record.title}` : 'Add experience'}
      action={formAction}
      pending={busy}
      onCancel={onClose}
      onDirty={onDirty}
      error={state.error ?? deleteError}
      submitLabel={record ? 'Save experience' : 'Add experience'}
      className="mt-5 rounded-2xl border border-ocean-100 bg-ocean-50/35 p-4 sm:p-5"
      footerStart={record && !confirmingDelete ? (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={busy}
          aria-label={`Delete ${record.title}`}
          className="min-h-10 rounded-xl px-3 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
        >
          Delete
        </button>
      ) : null}
    >
      <p className="text-xs font-semibold uppercase tracking-[.13em] text-ocean-700">{record ? 'Edit experience' : 'Add experience'}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Experience type
          <select name="track" value={track} onChange={(event) => setTrack(event.target.value as ProfileExperienceTrack)} className={inputClass}>
            {tracks.map((entry) => <option key={entry} value={entry}>{EXPERIENCE_TRACK_LABELS[entry]}</option>)}
          </select>
          <ProfileCardFieldError fieldErrors={errors} name="track" />
        </label>

        <label className={labelClass}>
          {labels.title}
          <input name="title" maxLength={160} defaultValue={record?.title ?? ''} className={inputClass} />
          <ProfileCardFieldError fieldErrors={errors} name="title" />
        </label>

        <label className={labelClass}>
          {labels.organization}
          <input name="organization" maxLength={180} defaultValue={record?.organization ?? ''} className={inputClass} />
          <ProfileCardFieldError fieldErrors={errors} name="organization" />
        </label>

        {seaService ? (
          <>
            <label className={labelClass}>
              Vessel
              <input name="vessel" maxLength={160} defaultValue={record?.vessel ?? ''} className={inputClass} />
              <ProfileCardFieldError fieldErrors={errors} name="vessel" />
            </label>
            <label className={labelClass}>
              Vessel type
              <input name="vesselType" maxLength={120} defaultValue={record?.vesselType ?? ''} className={inputClass} placeholder="Oil tanker, LNG, bulk carrier…" />
              <ProfileCardFieldError fieldErrors={errors} name="vesselType" />
            </label>
          </>
        ) : showLocation ? (
          <label className={labelClass}>
            Location
            <input name="location" maxLength={160} defaultValue={record?.location ?? ''} className={inputClass} />
            <ProfileCardFieldError fieldErrors={errors} name="location" />
          </label>
        ) : null}

        <label className={labelClass}>
          Start date
          <input name="startedOn" type="date" defaultValue={record?.startedOn ?? ''} className={inputClass} />
          <ProfileCardFieldError fieldErrors={errors} name="startedOn" />
        </label>
        <label className={labelClass}>
          End date
          <input name="endedOn" type="date" defaultValue={record?.endedOn ?? ''} className={inputClass} />
          <ProfileCardFieldError fieldErrors={errors} name="endedOn" />
        </label>

        <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950">
          <input name="isCurrent" type="checkbox" defaultChecked={record?.isCurrent ?? false} />
          {labels.current}
        </label>

        {seaService ? (
          <>
            <label className={labelClass}>
              Cargo experience
              <input name="cargoExperience" maxLength={2400} defaultValue={record?.cargoExperience.join(', ') ?? ''} className={inputClass} placeholder="Crude oil, CPP, chemicals…" />
              <ProfileCardFieldError fieldErrors={errors} name="cargoExperience" />
            </label>
            <label className={labelClass}>
              Engine experience
              <input name="engineExperience" maxLength={2400} defaultValue={record?.engineExperience.join(', ') ?? ''} className={inputClass} placeholder="MAN B&W, Wärtsilä, Sulzer…" />
              <ProfileCardFieldError fieldErrors={errors} name="engineExperience" />
            </label>
            <label className={labelClass}>
              Trading areas
              <input name="tradingAreas" maxLength={2400} defaultValue={record?.tradingAreas.join(', ') ?? ''} className={inputClass} placeholder="Worldwide, Arabian Gulf, Europe…" />
              <ProfileCardFieldError fieldErrors={errors} name="tradingAreas" />
            </label>
          </>
        ) : null}
      </div>

      <label className={`${labelClass} mt-4`}>
        Description
        <textarea name="description" maxLength={4000} rows={4} defaultValue={record?.description ?? ''} className={`${inputClass} py-3`} />
        <ProfileCardFieldError fieldErrors={errors} name="description" />
      </label>

      {record && confirmingDelete ? (
        <div
          role="group"
          aria-label={`Confirm deleting ${record.title}`}
          className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setConfirmingDelete(false)
            }
          }}
        >
          <p className="text-sm text-red-800">Delete this experience from your profile?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={remove} disabled={busy} className="min-h-10 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:opacity-60">
              {deleting ? 'Deleting…' : 'Delete experience'}
            </button>
            <button type="button" autoFocus onClick={() => setConfirmingDelete(false)} disabled={busy} className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:border-ocean-300">
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </ProfileCardForm>
  )
}

function ExperienceEntry({
  record,
  editable,
  persona,
}: {
  record: ProfileExperienceRecord
  editable: boolean
  persona: Persona | null
}) {
  const { editing: editorEditing, open: openEditor, close: closeEditor, markDirty: markEditorDirty, triggerRef: editorTriggerRef } = useProfileCardEditor(`experience:${record.id}`, record.title)
  const period = periodLabel(record)
  const seaService = record.track === 'sea_service'

  if (editable && editorEditing) {
    return (
      <div className="pl-0 sm:pl-2">
        <ExperienceEditor cardId={`experience:${record.id}`} record={record} persona={persona} onClose={closeEditor} onDirty={markEditorDirty} />
      </div>
    )
  }

  return (
    <article className="relative pl-8 max-md:pl-0 sm:pl-10">
      <span className="absolute left-[7px] top-1.5 size-3 rounded-full border-2 border-white bg-ocean-600 shadow-[0_0_0_3px_rgba(14,116,144,.13)] max-md:hidden" aria-hidden="true" />
      <div className="rounded-2xl border border-mist-100 bg-white p-4 shadow-sm max-md:rounded-none max-md:border-0 max-md:p-0 max-md:shadow-none sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-ocean-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[.1em] text-ocean-700">{EXPERIENCE_TRACK_LABELS[record.track]}</span>
              {record.isCurrent ? <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800">Current</span> : null}
            </div>
            <h3 className="mt-2 text-base font-semibold text-navy-950">{record.title}</h3>
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
            <button ref={editorTriggerRef} type="button" onClick={openEditor} aria-label={`Edit ${record.title}`} className={itemPencilClass}>
              <Pencil aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>

        {seaService && (record.vesselType || record.cargoExperience.length || record.engineExperience.length || record.tradingAreas.length) ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {record.vesselType ? <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Vessel type</p><p className="mt-1 text-sm text-ink">{record.vesselType}</p></div> : null}
            {record.cargoExperience.length ? <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Cargo</p><div className="mt-1 flex flex-wrap gap-1.5">{record.cargoExperience.map((item) => <span key={item} className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-medium text-navy-900">{item}</span>)}</div></div> : null}
            {record.engineExperience.length ? <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Engine</p><div className="mt-1 flex flex-wrap gap-1.5">{record.engineExperience.map((item) => <span key={item} className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-medium text-navy-900">{item}</span>)}</div></div> : null}
            {record.tradingAreas.length ? <div><p className="text-xs font-semibold uppercase tracking-wide text-muted">Trading areas</p><div className="mt-1 flex flex-wrap gap-1.5">{record.tradingAreas.map((item) => <span key={item} className="rounded-full bg-ocean-50 px-2.5 py-1 text-xs font-medium text-ocean-800">{item}</span>)}</div></div> : null}
          </div>
        ) : null}

        {record.description ? <p className="mt-4 whitespace-pre-line text-sm leading-6 text-ink">{record.description}</p> : null}
      </div>
    </article>
  )
}

export function ProfileCareerTimeline({
  experiences,
  editable = false,
  persona = null,
}: {
  experiences: ProfileExperienceRecord[]
  editable?: boolean
  /** The owner's profile type: picks the default experience type and whether sea service is offered. */
  persona?: Persona | null
}) {
  const { editing: adderEditing, open: openAdder, close: closeAdder, markDirty: markAdderDirty, triggerRef: adderTriggerRef } = useProfileCardEditor('experience:new', 'Add experience')
  const adding = editable && adderEditing

  if (!editable && experiences.length === 0) return null

  return (
    <ProfileSection
      id="profile-experience"
      title="Experience"
      action={editable && !adding ? (
        <button ref={adderTriggerRef} type="button" onClick={openAdder} className={PHONE_ICON_ADD_BUTTON_CLASS} aria-label="Add experience">
          <Plus aria-hidden="true" className="size-4 max-md:size-5" />
          <span className="max-md:sr-only">Add experience</span>
        </button>
      ) : null}
    >
      {adding ? <ExperienceEditor cardId="experience:new" persona={persona} onClose={closeAdder} onDirty={markAdderDirty} /> : null}

      {experiences.length ? (
        <PhoneShowAll
          noun="experience"
          className="relative mt-6 space-y-4 before:absolute before:bottom-6 before:left-3 before:top-2 before:w-px before:bg-mist-100 max-md:mt-4 max-md:space-y-5 max-md:before:hidden"
        >
          {experiences.map((record) => (
            <ExperienceEntry key={record.id} record={record} editable={editable} persona={persona} />
          ))}
        </PhoneShowAll>
      ) : editable && !adding ? (
        <div className="mt-6 rounded-2xl border border-dashed border-mist-100 bg-mist-50/50 p-6 text-center">
          <Briefcase aria-hidden="true" className="mx-auto size-7 text-ocean-600" />
          <p className="mt-2 text-sm font-semibold text-navy-950">Build your career timeline</p>
          <p className="mt-1 text-sm text-muted">
            {persona && persona !== 'seafarer' && persona !== 'student_cadet'
              ? 'Add the jobs, roles and training that tell people what you do.'
              : 'Add sea service, shore positions, training roles and other maritime experience.'}
          </p>
          <button type="button" onClick={openAdder} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-800 transition-colors">
            <Plus aria-hidden="true" className="size-4" />
            Add your first experience
          </button>
        </div>
      ) : null}
    </ProfileSection>
  )
}
