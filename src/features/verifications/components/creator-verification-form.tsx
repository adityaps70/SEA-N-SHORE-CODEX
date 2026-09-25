'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  submitCreatorVerification,
  type CreatorVerificationActionState,
} from '../actions'
import type {
  CreatorVerificationApplication,
  CreatorVerificationType,
} from '../application'

type InitialValues = {
  professionalRole: string
  organizationName: string
  experienceYears: string
  specializations: string
  experienceSummary: string
  evidenceUrl: string
  additionalNote: string
}

function firstError(state: CreatorVerificationActionState, field: string) {
  return state.fieldErrors?.[field]?.[0]
}

function copyFor(type: CreatorVerificationType) {
  if (type === 'recruiter') {
    return {
      eyebrow: 'Recruiter verification',
      title: 'Verify your recruiting experience',
      intro: 'Show Sea N Shore that you have genuine professional recruiting or crewing experience. Verification establishes trust; a Creator Pro plan is still required to publish jobs personally.',
      focusLabel: 'Hiring focus / maritime segments',
      focusPlaceholder: 'Tanker officers, Bulk carrier crew, Shore recruitment',
      summaryLabel: 'Recruitment experience',
      summaryPlaceholder: 'Describe the roles you recruit for, your responsibilities, typical hiring process and relevant maritime experience.',
    }
  }

  return {
    eyebrow: 'Event Host verification',
    title: 'Verify your event-hosting experience',
    intro: 'Show Sea N Shore that you can responsibly organize professional maritime events. Verification establishes trust; a Creator Pro plan is still required to publish events personally.',
    focusLabel: 'Event topics / formats',
    focusPlaceholder: 'Webinars, SIRE 2.0, Maritime safety, Conferences',
    summaryLabel: 'Event-hosting experience',
    summaryPlaceholder: 'Describe events you have organized or hosted, your responsibilities, audience and professional relevance.',
  }
}

function applicationToInitial(application: CreatorVerificationApplication | null | undefined): InitialValues | null {
  if (!application) return null
  return {
    professionalRole: application.professionalRole,
    organizationName: application.organizationName ?? '',
    experienceYears: String(application.experienceYears),
    specializations: application.specializations.join(', '),
    experienceSummary: application.experienceSummary,
    evidenceUrl: application.evidenceUrl ?? '',
    additionalNote: application.additionalNote ?? '',
  }
}

export function CreatorVerificationForm({
  type,
  initialValue,
}: {
  type: CreatorVerificationType
  initialValue: InitialValues | CreatorVerificationApplication
}) {
  const router = useRouter()
  const normalized = 'specializations' in initialValue && Array.isArray(initialValue.specializations)
    ? applicationToInitial(initialValue as CreatorVerificationApplication)!
    : initialValue as InitialValues
  const action = submitCreatorVerification.bind(null, type)
  const [state, formAction, pending] = useActionState(action, {
    values: normalized,
  })
  const copy = copyFor(type)
  const values = state.values ?? normalized

  useEffect(() => {
    if (state.ok) router.replace('/settings/verifications')
  }, [router, state.ok])

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">{copy.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-bold text-navy-950">{copy.title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{copy.intro}</p>
        <div className="mt-4 rounded-xl bg-mist-50 px-4 py-3 text-xs leading-5 text-muted">
          Your entries are preserved if validation or submission fails.
        </div>

        {state.error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {state.error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-navy-900">
            Professional role
            <input
              name="professionalRole"
              defaultValue={values.professionalRole ?? ''}
              placeholder={type === 'recruiter' ? 'Crewing Manager' : 'Maritime Event Organizer'}
              className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
            />
            {firstError(state, 'professionalRole') ? <span className="text-xs text-red-700">{firstError(state, 'professionalRole')}</span> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-navy-900">
            Organization <span className="font-normal text-muted">(optional)</span>
            <input
              name="organizationName"
              defaultValue={values.organizationName ?? ''}
              placeholder="Company, institute or independent"
              className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
            />
            {firstError(state, 'organizationName') ? <span className="text-xs text-red-700">{firstError(state, 'organizationName')}</span> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-navy-900">
            Relevant experience (years)
            <input
              name="experienceYears"
              type="number"
              min="0"
              max="70"
              step="1"
              defaultValue={values.experienceYears ?? ''}
              className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
            />
            {firstError(state, 'experienceYears') ? <span className="text-xs text-red-700">{firstError(state, 'experienceYears')}</span> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-navy-900">
            {copy.focusLabel}
            <input
              name="specializations"
              defaultValue={values.specializations ?? ''}
              placeholder={copy.focusPlaceholder}
              className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
            />
            <span className="text-xs font-normal text-muted">Separate multiple areas with commas.</span>
            {firstError(state, 'specializations') ? <span className="text-xs text-red-700">{firstError(state, 'specializations')}</span> : null}
          </label>
        </div>

        <label className="mt-4 grid gap-1.5 text-sm font-semibold text-navy-900">
          {copy.summaryLabel}
          <textarea
            name="experienceSummary"
            defaultValue={values.experienceSummary ?? ''}
            placeholder={copy.summaryPlaceholder}
            className="min-h-36 rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm leading-6"
          />
          {firstError(state, 'experienceSummary') ? <span className="text-xs text-red-700">{firstError(state, 'experienceSummary')}</span> : null}
        </label>

        <label className="mt-4 grid gap-1.5 text-sm font-semibold text-navy-900">
          Public evidence URL <span className="font-normal text-muted">(optional but recommended)</span>
          <input
            name="evidenceUrl"
            type="url"
            defaultValue={values.evidenceUrl ?? ''}
            placeholder="https://www.linkedin.com/in/... or a public professional page"
            className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
          />
          {firstError(state, 'evidenceUrl') ? <span className="text-xs text-red-700">{firstError(state, 'evidenceUrl')}</span> : null}
        </label>

        <label className="mt-4 grid gap-1.5 text-sm font-semibold text-navy-900">
          Additional note <span className="font-normal text-muted">(optional)</span>
          <textarea
            name="additionalNote"
            defaultValue={values.additionalNote ?? ''}
            placeholder="Anything that will help the Sea N Shore team verify your professional activity."
            className="min-h-24 rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm leading-6"
          />
          {firstError(state, 'additionalNote') ? <span className="text-xs text-red-700">{firstError(state, 'additionalNote')}</span> : null}
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-xs leading-5 text-muted">
          Approval verifies professional trust only. It does not activate Creator Pro, Organization Pro or any paid publishing entitlement.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 shrink-0 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? 'Submitting…' : 'Submit for verification'}
        </button>
      </section>
    </form>
  )
}
