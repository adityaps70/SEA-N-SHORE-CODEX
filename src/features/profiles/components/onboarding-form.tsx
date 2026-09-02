'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { completeOnboarding, type ProfileActionState } from '../actions'
import type { ProfileType } from '../types'
import { ProfileTypeCard } from './profile-type-card'

const profileTypeOptions: ReadonlyArray<{
  value: ProfileType
  label: string
  description: string
}> = [
  { value: 'seafarer', label: 'Seafarer', description: 'For serving crew and officers building a sea-going career.' },
  { value: 'maritime_professional', label: 'Maritime professional', description: 'For shore-based specialists with maritime experience.' },
  { value: 'company', label: 'Company operator', description: 'For the person responsible for representing an organisation.' },
  { value: 'trainer', label: 'Trainer', description: 'For educators delivering maritime learning and assessment.' },
  { value: 'mentor', label: 'Mentor', description: 'For experienced professionals guiding the next generation.' },
  { value: 'recruiter', label: 'Recruiter', description: 'For talent professionals connecting people and roles.' },
  { value: 'service_provider', label: 'Service provider', description: 'For specialists and suppliers serving the maritime sector.' },
]

function firstError(state: ProfileActionState, field: string) {
  return state.fieldErrors?.[field]?.[0]
}
type TextAreaFieldProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
  error?: string
  hint?: string
}

function TextAreaField({ label, error, hint, id, name, className, ...props }: TextAreaFieldProps) {
  const inputId = id ?? name
  const descriptionId = inputId ? `${inputId}-description` : undefined
  return (
    <label htmlFor={inputId} className="grid gap-2 text-sm font-medium text-navy-900">
      {label}
      <textarea
        id={inputId}
        name={name}
        aria-label={label}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? descriptionId : undefined}
        className={`min-h-32 resize-y rounded-xl border border-mist-100 bg-white px-4 py-3 text-base text-ink shadow-sm placeholder:text-muted focus:border-ocean-700 ${className ?? ''}`}
        {...props}
      />
      {error || hint ? (
        <span id={descriptionId} className={error ? 'text-red-700' : 'text-muted'}>
          {error ?? hint}
        </span>
      ) : null}
    </label>
  )
}

function OnboardingFields({
  initialFullName,
  state,
}: {
  initialFullName: string
  state: ProfileActionState
}) {
  const values = state.values
  const [profileType, setProfileType] = useState<ProfileType | undefined>(values?.profileType)
  const profileTypeError = firstError(state, 'profileType')
  const contactVisibilityError = firstError(state, 'contactVisibility')

  return (
    <>
      <fieldset aria-describedby={profileTypeError ? 'profileType-description' : undefined}>
        <legend className="text-xl font-semibold tracking-tight text-navy-950">Choose your professional path</legend>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">This shapes the information your Sea N Shore profile highlights.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profileTypeOptions.map((option) => (
            <ProfileTypeCard
              key={option.value}
              {...option}
              checked={profileType === option.value}
              onChange={setProfileType}
            />
          ))}
        </div>
        {profileTypeError ? <p id="profileType-description" className="mt-3 text-sm text-red-700">{profileTypeError}</p> : null}
      </fieldset>

      <fieldset className="grid gap-5">
        <legend className="text-xl font-semibold tracking-tight text-navy-950">Professional identity</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name" name="fullName" defaultValue={values?.fullName ?? initialFullName} error={firstError(state, 'fullName')} autoComplete="name" required />
          <Field label="Profile address" name="slug" defaultValue={values?.slug} error={firstError(state, 'slug')} hint="Letters, numbers, and hyphens — for example asha-singh." autoComplete="off" required />
          <Field label="Location" name="location" defaultValue={values?.location} error={firstError(state, 'location')} autoComplete="address-level2" />
          <Field label="Professional headline" name="headline" defaultValue={values?.headline} error={firstError(state, 'headline')} required />
        </div>
        <TextAreaField label="Professional summary" name="summary" defaultValue={values?.summary} error={firstError(state, 'summary')} hint="Share your experience, focus, and the work you hope to do next." required />
        <Field label="Skills" name="skills" defaultValue={values?.skills} error={firstError(state, 'skills')} hint="Separate up to 20 skills with commas." />
        <label htmlFor="contactVisibility" className="grid gap-2 text-sm font-medium text-navy-900 sm:max-w-sm">
          Who can see my contact details?
          <select
            id="contactVisibility"
            name="contactVisibility"
            defaultValue={values?.contactVisibility ?? 'members'}
            aria-invalid={Boolean(contactVisibilityError)}
            aria-describedby={contactVisibilityError ? 'contactVisibility-description' : undefined}
            className="min-h-12 rounded-xl border border-mist-100 bg-white px-4 text-base text-ink shadow-sm focus:border-ocean-700"
          >
            <option value="private">Only me</option>
            <option value="members">Sea N Shore members</option>
            <option value="public">Everyone</option>
          </select>
          {contactVisibilityError ? <span id="contactVisibility-description" className="text-red-700">{contactVisibilityError}</span> : null}
        </label>
      </fieldset>

      <fieldset className="onboarding-maritime-fields grid gap-5 rounded-3xl border border-mist-100 bg-mist-50 p-5 sm:p-7">
        <legend className="px-2 text-xl font-semibold tracking-tight text-navy-950">Sea-going experience</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Current or most recent rank"
            name="rank"
            defaultValue={values?.rank}
            error={firstError(state, 'rank')}
            hint={profileType === 'seafarer' ? 'Required for seafarers' : 'Optional'}
            required={profileType === 'seafarer'}
          />
          <Field label="Current company" name="currentCompany" defaultValue={values?.currentCompany} error={firstError(state, 'currentCompany')} />
          <Field label="Current vessel" name="currentVessel" defaultValue={values?.currentVessel} error={firstError(state, 'currentVessel')} />
          <Field label="Sailing experience in years" name="sailingExperienceYears" defaultValue={values?.sailingExperienceYears} type="number" min="0" max="70" step="0.1" error={firstError(state, 'sailingExperienceYears')} />
          <Field label="Vessel types" name="vesselTypes" defaultValue={values?.vesselTypes} error={firstError(state, 'vesselTypes')} hint="Separate entries with commas." />
          <Field label="Trading areas" name="tradingAreas" defaultValue={values?.tradingAreas} error={firstError(state, 'tradingAreas')} hint="Separate entries with commas." />
          <Field label="Availability" name="availability" defaultValue={values?.availability} error={firstError(state, 'availability')} />
        </div>
        <label className="flex min-h-12 items-center gap-3 text-sm font-medium text-navy-900">
          <input
            className="size-5 accent-[var(--ocean-700)]"
            type="checkbox"
            name="shoreCareerPreference"
            defaultChecked={values?.shoreCareerPreference}
          />
          I am interested in shore-based career opportunities
        </label>
      </fieldset>
    </>
  )
}

export function OnboardingForm({ initialFullName }: { initialFullName: string }) {
  const [state, formAction, pending] = useActionState(completeOnboarding, { revision: 0 })

  return (
    <form action={formAction} className="onboarding-form grid gap-10" noValidate>
      <OnboardingFields key={state.revision ?? 0} initialFullName={initialFullName} state={state} />

      {state.error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p> : null}
      <div className="flex flex-col gap-3 border-t border-mist-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm leading-6 text-muted">Your profile starts with only the details you choose to share.</p>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? 'Saving your profile…' : 'Complete profile'}
        </Button>
      </div>
    </form>
  )
}
