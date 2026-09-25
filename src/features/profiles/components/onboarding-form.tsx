'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import {
  Anchor,
  BriefcaseBusiness,
  Building2,
  Check,
  Compass,
  GraduationCap,
  Heart,
  School,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { FormErrorSummary, focusFirstFormError, hasFormErrors } from '@/components/ui/form-error-summary'
import { completeActivation, type ProfileActionState } from '../actions'
import {
  PERSONAS,
  PROFILE_INTENTS,
  PERSONA_LABELS,
  PROFILE_INTENT_LABELS,
  type Persona,
  type ProfileIntent,
} from '../persona'
import { UsernameField } from './username-field'

function firstError(state: ProfileActionState, field: string) {
  return state.fieldErrors?.[field]?.[0]
}

function readIntents(value?: string): ProfileIntent[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is ProfileIntent =>
      typeof entry === 'string' && PROFILE_INTENTS.includes(entry as ProfileIntent))
  } catch {
    return []
  }
}

const personaOptions = [
  {
    id: 'seafarer',
    label: 'Seafarer',
    description: 'Master, officer, engineer, rating, cadet or other sea-going professional.',
    icon: Anchor,
  },
  {
    id: 'shore_professional',
    label: 'Shore Professional',
    description: 'Superintendent, DPA, marine manager or another shore-based professional.',
    icon: Building2,
  },
  {
    id: 'recruiter_hr',
    label: 'Recruiter / HR',
    description: 'Crewing, manning, recruitment or maritime HR professional.',
    icon: BriefcaseBusiness,
  },
  {
    id: 'trainer_instructor',
    label: 'Trainer / Instructor',
    description: 'Maritime trainer, instructor, assessor or academy faculty.',
    icon: GraduationCap,
  },
  {
    id: 'student_cadet',
    label: 'Student / Cadet',
    description: 'Maritime student, cadet or aspiring maritime professional.',
    icon: School,
  },
  {
    id: 'seafarer_family',
    label: 'Seafarer Family',
    description: 'Spouse, partner, parent or family member of a seafarer.',
    icon: Heart,
  },
  {
    id: 'maritime_enthusiast',
    label: 'Maritime Enthusiast',
    description: 'Here for the maritime community, knowledge and industry network.',
    icon: Compass,
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Another participant in or around the maritime ecosystem.',
    icon: Compass,
  },
] as const satisfies ReadonlyArray<{
  id: Persona
  label: string
  description: string
  icon: typeof Anchor
}>

const intentOptions = PROFILE_INTENTS.map((id) => ({ id, label: PROFILE_INTENT_LABELS[id] }))

function OnboardingFields({
  initialFullName,
  state,
}: {
  initialFullName: string
  state: ProfileActionState
}) {
  const values = state.values
  const [persona, setPersona] = useState<Persona | undefined>(values?.persona)
  const [intents, setIntents] = useState<ProfileIntent[]>(readIntents(values?.profileIntents))

  const personaError = firstError(state, 'persona')
  const intentError = firstError(state, 'profileIntents')
  const contactVisibilityError = firstError(state, 'contactVisibility')

  function toggleIntent(intent: ProfileIntent) {
    setIntents((current) =>
      current.includes(intent)
        ? current.filter((entry) => entry !== intent)
        : [...current, intent],
    )
  }

  return (
    <>
      <fieldset
        aria-invalid={Boolean(personaError)}
        data-form-error-target={personaError ? 'true' : undefined}
        tabIndex={personaError ? -1 : undefined}
        className={personaError ? 'rounded-2xl outline-none focus:ring-2 focus:ring-red-300' : undefined}
      >
        <legend className="text-xl font-semibold tracking-tight text-navy-950">Which best describes you?</legend>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Pick the closest fit. This only personalizes your profile and onboarding — it does not grant publishing permissions.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {personaOptions.map((option) => {
            const selected = persona === option.id
            const Icon = option.icon
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setPersona(option.id)}
                aria-label={option.label}
                aria-pressed={selected}
                className={`group relative rounded-2xl border p-4 text-left transition-all duration-200 ${
                  selected
                    ? 'border-ocean-600 bg-ocean-50 shadow-[0_12px_30px_rgba(15,113,151,0.10)] ring-1 ring-ocean-200'
                    : 'border-mist-100 bg-white hover:-translate-y-0.5 hover:border-ocean-300 hover:shadow-md'
                }`}
              >
                <span className={`mb-3 grid size-10 place-items-center rounded-xl transition ${
                  selected ? 'bg-ocean-700 text-white' : 'bg-mist-50 text-ocean-700 group-hover:bg-ocean-50'
                }`}>
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="block pr-8 text-sm font-semibold text-navy-950">{option.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted">{option.description}</span>
                {selected ? (
                  <span className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-ocean-700 text-white" aria-hidden="true">
                    <Check className="size-3.5" />
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        {personaError ? <p className="mt-3 text-sm font-medium text-red-700">{personaError}</p> : null}
      </fieldset>

      {persona ? (
        <fieldset
          aria-invalid={Boolean(intentError)}
          data-form-error-target={intentError ? 'true' : undefined}
          tabIndex={intentError ? -1 : undefined}
          className={`rounded-3xl border bg-mist-50 p-5 outline-none sm:p-7 ${
            intentError ? 'border-red-200 focus:ring-2 focus:ring-red-300' : 'border-mist-100'
          }`}
        >
          <legend className="px-2 text-xl font-semibold tracking-tight text-navy-950">What are you here to do?</legend>
          <p className="text-sm leading-6 text-muted">Choose everything that matters to you. You can change this later.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {intentOptions.map((option) => {
              const selected = intents.includes(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggleIntent(option.id)}
                  aria-label={option.label}
                  aria-pressed={selected}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    selected
                      ? 'border-ocean-700 bg-ocean-700 text-white'
                      : 'border-mist-100 bg-white text-navy-900 hover:border-ocean-300'
                  }`}
                >
                  {selected ? '✓ ' : ''}{option.label}
                </button>
              )
            })}
          </div>
          {intentError ? <p className="mt-3 text-sm font-medium text-red-700">{intentError}</p> : null}
        </fieldset>
      ) : null}

      {persona ? (
        <fieldset className="grid gap-5">
          <legend className="text-xl font-semibold tracking-tight text-navy-950">Your profile basics</legend>
          <p className="text-sm leading-6 text-muted">
            We only ask for details relevant to {PERSONA_LABELS[persona].toLowerCase()}. You can add more profile depth later.
          </p>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Full name"
              name="fullName"
              defaultValue={values?.fullName ?? initialFullName}
              error={firstError(state, 'fullName')}
              autoComplete="name"
              required
            />
            <UsernameField
              initialValue={values?.slug}
              serverError={firstError(state, 'slug')}
            />
            <Field
              label="Location"
              name="location"
              defaultValue={values?.location}
              error={firstError(state, 'location')}
              autoComplete="address-level2"
            />

            {persona === 'seafarer' ? (
              <>
                <Field
                  label="Current or most recent rank"
                  name="rank"
                  defaultValue={values?.rank}
                  error={firstError(state, 'rank')}
                  required
                />
                <Field
                  label="Current / last organisation"
                  name="currentCompany"
                  defaultValue={values?.currentCompany}
                  error={firstError(state, 'currentCompany')}
                  autoComplete="organization"
                />
              </>
            ) : null}

            {persona === 'shore_professional' ? (
              <>
                <Field
                  label="Current role / designation"
                  name="headline"
                  defaultValue={values?.headline}
                  error={firstError(state, 'headline')}
                />
                <Field
                  label="Current organisation"
                  name="currentCompany"
                  defaultValue={values?.currentCompany}
                  error={firstError(state, 'currentCompany')}
                  autoComplete="organization"
                />
              </>
            ) : null}

            {persona === 'recruiter_hr' ? (
              <>
                <Field
                  label="Role / designation"
                  name="headline"
                  defaultValue={values?.headline}
                  error={firstError(state, 'headline')}
                />
                <Field
                  label="Current organisation"
                  name="currentCompany"
                  defaultValue={values?.currentCompany}
                  error={firstError(state, 'currentCompany')}
                  autoComplete="organization"
                />
              </>
            ) : null}

            {persona === 'trainer_instructor' ? (
              <>
                <Field
                  label="Training specialization"
                  name="specialization"
                  defaultValue={values?.specialization}
                  error={firstError(state, 'specialization')}
                  hint="For example: SIRE 2.0, navigation, human factors or marine engineering."
                />
                <Field
                  label="Organisation / institute"
                  name="currentCompany"
                  defaultValue={values?.currentCompany}
                  error={firstError(state, 'currentCompany')}
                  autoComplete="organization"
                />
              </>
            ) : null}

            {persona === 'student_cadet' ? (
              <Field
                label="Institute / academy"
                name="institutionName"
                defaultValue={values?.institutionName}
                error={firstError(state, 'institutionName')}
              />
            ) : null}

            {persona === 'seafarer_family' ? (
              <Field
                label="Relationship to the maritime community"
                name="familyRelationship"
                defaultValue={values?.familyRelationship}
                error={firstError(state, 'familyRelationship')}
                hint="For example: spouse / partner, parent or family member."
              />
            ) : null}

            {persona === 'other' ? (
              <Field
                label="How would you describe yourself?"
                name="headline"
                defaultValue={values?.headline}
                error={firstError(state, 'headline')}
              />
            ) : null}
          </div>

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
      ) : null}

      <input type="hidden" name="persona" value={persona ?? ''} />
      <input type="hidden" name="profileIntents" value={JSON.stringify(intents)} />
    </>
  )
}

const onboardingFieldLabels: Record<string, string> = {
  persona: 'Profile',
  profileIntents: 'What you are here to do',
  fullName: 'Name',
  slug: 'Username',
  location: 'Location',
  rank: 'Rank',
  currentCompany: 'Current organisation',
  headline: 'Role / headline',
  specialization: 'Training specialization',
  institutionName: 'Institute / academy',
  familyRelationship: 'Relationship',
  contactVisibility: 'Contact visibility',
}

function captureSubmittedActivationValues(formData: FormData): ProfileActionState['values'] {
  const text = (name: string) => {
    const value = formData.get(name)
    return typeof value === 'string' ? value : undefined
  }
  const personaValue = text('persona')
  const contactVisibilityValue = text('contactVisibility')

  return {
    persona: PERSONAS.includes(personaValue as Persona) ? personaValue as Persona : undefined,
    profileIntents: text('profileIntents'),
    fullName: text('fullName'),
    slug: text('slug'),
    location: text('location'),
    rank: text('rank'),
    currentCompany: text('currentCompany'),
    headline: text('headline'),
    specialization: text('specialization'),
    institutionName: text('institutionName'),
    familyRelationship: text('familyRelationship'),
    contactVisibility: contactVisibilityValue === 'private'
      || contactVisibilityValue === 'members'
      || contactVisibilityValue === 'public'
      ? contactVisibilityValue
      : undefined,
  }
}

async function completeActivationSafely(previousState: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  try {
    return await completeActivation(previousState, formData)
  } catch {
    return {
      error: 'We could not submit your profile. Check your connection and try again. Your information is still here.',
      fieldErrors: undefined,
      revision: (previousState.revision ?? 0) + 1,
      values: captureSubmittedActivationValues(formData),
    }
  }
}

export function OnboardingForm({ initialFullName }: { initialFullName: string }) {
  const [state, formAction, pending] = useActionState(completeActivationSafely, { revision: 0 })
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!hasFormErrors(state.error, state.fieldErrors)) return
    focusFirstFormError(formRef.current)
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="onboarding-form grid gap-10" noValidate>
      <FormErrorSummary
        error={state.error}
        fieldErrors={state.fieldErrors}
        fieldLabels={onboardingFieldLabels}
      />

      <OnboardingFields
        initialFullName={initialFullName}
        state={state}
      />

      <div className="flex flex-col gap-3 border-t border-mist-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm leading-6 text-muted">
          Start with the essentials. Jobs, events and course publishing are activated separately through verification and plan access.
        </p>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? 'Saving your profile…' : 'Complete profile'}
        </Button>
      </div>
    </form>
  )
}
