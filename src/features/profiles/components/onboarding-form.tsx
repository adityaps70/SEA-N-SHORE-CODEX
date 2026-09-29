'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronLeft, type LucideIcon } from 'lucide-react'
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
import { DG_PROFILE_EXPLANATION, DG_PROFILE_VISIBILITY, type ProfileDocumentSummary } from '../profile-document-policy'
import { PERSONA_ICONS } from '../persona-icons'
import { DgProfileUpload } from './dg-profile-upload'
import { OrganizationPicker, type PickerOrganization } from './organization-picker'
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
    icon: PERSONA_ICONS.seafarer,
  },
  {
    id: 'shore_professional',
    label: 'Shore Professional',
    description: 'Superintendent, DPA, marine manager or another shore-based professional.',
    icon: PERSONA_ICONS.shore_professional,
  },
  {
    id: 'recruiter_hr',
    label: 'Recruiter / HR',
    description: 'Crewing, manning, recruitment or maritime HR professional.',
    icon: PERSONA_ICONS.recruiter_hr,
  },
  {
    id: 'trainer_instructor',
    label: 'Trainer / Instructor',
    description: 'Maritime trainer, instructor, assessor or academy faculty.',
    icon: PERSONA_ICONS.trainer_instructor,
  },
  {
    id: 'student_cadet',
    label: 'Student / Cadet',
    description: 'Maritime student, cadet or aspiring maritime professional.',
    icon: PERSONA_ICONS.student_cadet,
  },
  {
    id: 'seafarer_family',
    label: 'Seafarer Family',
    description: 'Spouse, partner, parent or family member of a seafarer.',
    icon: PERSONA_ICONS.seafarer_family,
  },
  {
    id: 'maritime_enthusiast',
    label: 'Maritime Enthusiast',
    description: 'Here for the maritime community, knowledge and industry network.',
    icon: PERSONA_ICONS.maritime_enthusiast,
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Another participant in or around the maritime ecosystem.',
    icon: PERSONA_ICONS.other,
  },
] as const satisfies ReadonlyArray<{
  id: Persona
  label: string
  description: string
  icon: LucideIcon
}>

const intentOptions = PROFILE_INTENTS.map((id) => ({ id, label: PROFILE_INTENT_LABELS[id] }))

type OnboardingFormProps = {
  initialFullName: string
  /** A rule-valid, available handle generated from the member's name or email. */
  suggestedUsername?: string
  profileId?: string
  initialDgProfile?: ProfileDocumentSummary | null
  /** An organization the member just registered from the picker, to link as their current organization. */
  registeredOrganization?: PickerOrganization | null
}

/** Session draft of the onboarding answers while the member registers their organization. */
const ONBOARDING_DRAFT_KEY = 'sns:onboarding-draft'

function saveOnboardingDraft(link: HTMLAnchorElement) {
  const form = link.closest('form')
  if (!form) return
  try {
    window.sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(captureSubmittedActivationValues(new FormData(form))))
  } catch {
    // Storage can be unavailable (private mode); the member simply re-enters their answers.
  }
}

function takeOnboardingDraft(): ProfileActionState['values'] | undefined {
  try {
    const raw = window.sessionStorage.getItem(ONBOARDING_DRAFT_KEY)
    if (!raw) return undefined
    window.sessionStorage.removeItem(ONBOARDING_DRAFT_KEY)
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    const formData = new FormData()
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') formData.set(key, value)
    }
    return captureSubmittedActivationValues(formData)
  } catch {
    return undefined
  }
}

/**
 * Phones walk through the form one part at a time (who you are → what you are here to
 * do → profile basics). It is still one form: parts not on screen are only hidden with
 * CSS below md, so every field is submitted and desktop keeps the single page.
 */
type PhoneStep = 1 | 2 | 3
const PHONE_STEPS: Record<PhoneStep, string> = {
  1: 'Which best describes you?',
  2: 'What are you here to do?',
  3: 'Your profile basics',
}
const PHONE_STEP_COUNT = 3

/** The step that holds the first field the server rejected. */
function phoneStepForErrors(fieldErrors: ProfileActionState['fieldErrors']): PhoneStep | null {
  if (!fieldErrors) return null
  if (fieldErrors.persona?.length) return 1
  if (fieldErrors.profileIntents?.length) return 2
  return Object.values(fieldErrors).some((messages) => messages?.length) ? 3 : null
}

const phoneNextClass = 'sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 mt-6 inline-flex min-h-12 w-full shadow-[0_10px_24px_-12px_rgb(7_27_45/0.55)] cursor-pointer items-center justify-center gap-2 rounded-full bg-ocean-700 px-5 text-base font-semibold text-white transition-colors hover:bg-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60 md:hidden'

function OnboardingFields({
  initialFullName,
  suggestedUsername = '',
  profileId,
  initialDgProfile = null,
  registeredOrganization = null,
  state,
  phoneStep = 1,
  onPhoneStep,
}: OnboardingFormProps & { state: ProfileActionState; phoneStep?: PhoneStep; onPhoneStep?: (step: PhoneStep) => void }) {
  const values = state.values
  const [persona, setPersona] = useState<Persona | undefined>(values?.persona)
  const [intents, setIntents] = useState<ProfileIntent[]>(readIntents(values?.profileIntents))
  const [dgProfile, setDgProfile] = useState<ProfileDocumentSummary | null>(initialDgProfile)

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
        className={[personaError ? 'rounded-2xl outline-none focus:ring-2 focus:ring-red-300' : '', phoneStep !== 1 ? 'max-md:hidden' : ''].filter(Boolean).join(' ') || undefined}
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
                className={`group relative rounded-2xl border p-4 text-left transition-all duration-200 max-md:flex max-md:items-start max-md:gap-3 max-md:p-3.5 ${
                  selected
                    ? 'border-ocean-600 bg-ocean-50 shadow-[0_12px_30px_rgba(15,113,151,0.10)] ring-1 ring-ocean-200'
                    : 'border-mist-200 bg-white hover:-translate-y-0.5 hover:border-ocean-300 hover:shadow-md'
                }`}
              >
                <span className={`mb-3 grid size-10 place-items-center rounded-xl transition max-md:mb-0 max-md:shrink-0 ${
                  selected ? 'bg-ocean-700 text-white' : 'bg-mist-50 text-ocean-700 group-hover:bg-ocean-50'
                }`}>
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="block min-w-0">
                  <span className="block pr-8 text-sm font-semibold text-navy-950 max-md:text-[15px]">{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted max-md:mt-0.5 max-md:text-[13px]">{option.description}</span>
                </span>
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
        <button type="button" className={phoneNextClass} disabled={!persona} onClick={() => onPhoneStep?.(2)}>
          Continue <ArrowRight aria-hidden="true" className="size-4" />
        </button>
      </fieldset>

      {persona ? (
        <fieldset
          aria-invalid={Boolean(intentError)}
          data-form-error-target={intentError ? 'true' : undefined}
          tabIndex={intentError ? -1 : undefined}
          className={`rounded-3xl border bg-mist-50 p-5 outline-none sm:p-7 ${
            intentError ? 'border-red-200 focus:ring-2 focus:ring-red-300' : 'border-mist-100'
          }${phoneStep !== 2 ? ' max-md:hidden' : ''}`}
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
                      : 'border-mist-200 bg-white text-navy-900 hover:border-ocean-300'
                  }`}
                >
                  {selected ? '✓ ' : ''}{option.label}
                </button>
              )
            })}
          </div>
          {intentError ? <p className="mt-3 text-sm font-medium text-red-700">{intentError}</p> : null}
          <button type="button" className={phoneNextClass} onClick={() => onPhoneStep?.(3)}>
            Continue <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </fieldset>
      ) : null}

      {persona ? (
        <fieldset className={`grid gap-5${phoneStep !== 3 ? ' max-md:hidden' : ''}`}>
          <legend className="text-xl font-semibold tracking-tight text-navy-950">Your profile basics</legend>
          <p className="text-sm leading-6 text-muted">
            We only ask for details relevant to {PERSONA_LABELS[persona].toLowerCase()}. You can add more profile depth later.
          </p>

          {/* items-start: the username field grows with its status text; neighbours must not stretch to match. */}
          <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
            <Field
              label="Full name"
              name="fullName"
              defaultValue={values?.fullName ?? initialFullName}
              error={firstError(state, 'fullName')}
              autoComplete="name"
              required
            />
            <UsernameField
              initialValue={values?.slug ?? suggestedUsername}
              serverError={firstError(state, 'slug')}
              fallbackUsername={suggestedUsername}
              helpText={suggestedUsername
                ? 'We created this for you. Keep it or change it now or later from your profile.'
                : 'You can change your username later from your profile.'}
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
                <OnboardingOrganizationPicker
                  registeredOrganization={registeredOrganization}
                  label="Current / last organisation"
                  values={values}
                  revision={state.revision}
                  error={firstError(state, 'currentCompany') ?? firstError(state, 'currentCompanyId')}
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
                <OnboardingOrganizationPicker
                  registeredOrganization={registeredOrganization}
                  label="Current organisation"
                  values={values}
                  revision={state.revision}
                  error={firstError(state, 'currentCompany') ?? firstError(state, 'currentCompanyId')}
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
                <OnboardingOrganizationPicker
                  registeredOrganization={registeredOrganization}
                  label="Current organisation"
                  values={values}
                  revision={state.revision}
                  error={firstError(state, 'currentCompany') ?? firstError(state, 'currentCompanyId')}
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
                <OnboardingOrganizationPicker
                  registeredOrganization={registeredOrganization}
                  label="Organisation / institute"
                  values={values}
                  revision={state.revision}
                  error={firstError(state, 'currentCompany') ?? firstError(state, 'currentCompanyId')}
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

          {persona === 'seafarer' && profileId ? (
            <section aria-labelledby="dg-profile-heading" className="rounded-2xl border border-mist-100 bg-mist-50 p-4 sm:p-5">
              <h3 id="dg-profile-heading" className="text-sm font-semibold text-navy-950">
                DG Shipping profile <span className="font-normal text-muted">(optional)</span>
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted">{DG_PROFILE_EXPLANATION} {DG_PROFILE_VISIBILITY}</p>
              <p className="mt-1 text-xs text-muted">You can skip this and add it later from your profile.</p>
              <div className="mt-3">
                <DgProfileUpload
                  profileId={profileId}
                  initialDocument={dgProfile}
                  onDocumentChange={setDgProfile}
                  variant="onboarding"
                />
              </div>
            </section>
          ) : null}

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
      <input type="hidden" name="usernameSuggestion" value={suggestedUsername} />
      <input type="hidden" name="profileIntents" value={JSON.stringify(intents)} />
    </>
  )
}

const onboardingInputClass = 'min-h-12 w-full rounded-xl border border-mist-100 bg-white px-4 text-base text-ink shadow-sm outline-none placeholder:text-muted focus:border-ocean-700'

/** Current organization field with the Sea N Shore organization type-ahead. */
function OnboardingOrganizationPicker({
  label,
  values,
  revision,
  error,
  registeredOrganization,
}: {
  label: string
  values: ProfileActionState['values']
  /** Each server response restarts the picker from the values that were submitted. */
  revision?: number
  error?: string
  registeredOrganization?: PickerOrganization | null
}) {
  const name = values?.currentCompany ?? ''
  const id = values?.currentCompanyId ?? ''
  // Back from registering: link the new organization until the member chooses something else.
  const registered = registeredOrganization && (!revision || id === registeredOrganization.id) ? registeredOrganization : null
  return (
    <OrganizationPicker
      key={revision ?? 0}
      label={label}
      defaultName={registered?.name ?? name}
      defaultOrganization={registered ?? (id && name.trim() ? { id, name: name.trim() } : null)}
      error={error}
      labelClassName="grid gap-2 text-sm font-medium text-navy-900"
      inputClassName={onboardingInputClass}
      returnTo="/onboarding"
      onBeforeRegister={saveOnboardingDraft}
      phoneFullScreen
    />
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
    usernameSuggestion: text('usernameSuggestion'),
    location: text('location'),
    rank: text('rank'),
    currentCompany: text('currentCompany'),
    currentCompanyId: text('currentCompanyId'),
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

export function OnboardingForm({ initialFullName, suggestedUsername, profileId, initialDgProfile, registeredOrganization }: OnboardingFormProps) {
  const [state, formAction, pending] = useActionState(completeActivationSafely, { revision: 0 })
  const [draft, setDraft] = useState<ProfileActionState['values']>()
  const [phoneStep, setPhoneStep] = useState<PhoneStep>(1)
  const [focusRequest, setFocusRequest] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)

  // Restore the answers saved before the member left to register their organization.
  useEffect(() => {
    const saved = takeOnboardingDraft()
    if (!saved) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is only readable after hydration
    setDraft(saved)
    // They left from the organization field, in the last step.
    setPhoneStep(3)
  }, [])
  const fieldsState = state.values || !draft ? state : { ...state, values: draft }

  // A rejected submit: on phones show the step with the first problem, then focus it.
  useEffect(() => {
    if (!hasFormErrors(state.error, state.fieldErrors)) return
    const step = phoneStepForErrors(state.fieldErrors)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the step follows the server's answer
    if (step) setPhoneStep(step)
    setFocusRequest((count) => count + 1)
  }, [state])

  useEffect(() => {
    if (focusRequest) focusFirstFormError(formRef.current)
  }, [focusRequest])

  function goToPhoneStep(step: PhoneStep) {
    setPhoneStep(step)
    // Start the new step at the top of the page.
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0 })
  }

  return (
    <form ref={formRef} action={formAction} className="onboarding-form grid gap-10" noValidate>
      <div className="-mb-4 md:hidden" data-onboarding-progress="">
        <div className="flex min-h-11 items-center gap-2">
          {phoneStep > 1 ? (
            <button
              type="button"
              onClick={() => goToPhoneStep((phoneStep - 1) as PhoneStep)}
              className="-ml-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full px-2 text-sm font-semibold text-navy-950 hover:bg-mist-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
              Back
            </button>
          ) : null}
          <p className="ml-auto text-[13px] font-semibold text-muted" aria-live="polite">
            Step {phoneStep} of {PHONE_STEP_COUNT}
            <span className="sr-only"> · {PHONE_STEPS[phoneStep]}</span>
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Profile setup progress"
          aria-valuemin={1}
          aria-valuemax={PHONE_STEP_COUNT}
          aria-valuenow={phoneStep}
          aria-valuetext={`Step ${phoneStep} of ${PHONE_STEP_COUNT}: ${PHONE_STEPS[phoneStep]}`}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist-100"
        >
          <div className="h-full rounded-full bg-ocean-700 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${(phoneStep / PHONE_STEP_COUNT) * 100}%` }} />
        </div>
      </div>

      <FormErrorSummary
        error={state.error}
        fieldErrors={state.fieldErrors}
        fieldLabels={onboardingFieldLabels}
      />

      <OnboardingFields
        key={draft && !state.values ? 'restored' : 'fresh'}
        initialFullName={initialFullName}
        suggestedUsername={suggestedUsername}
        profileId={profileId}
        initialDgProfile={initialDgProfile}
        registeredOrganization={registeredOrganization}
        state={fieldsState}
        phoneStep={phoneStep}
        onPhoneStep={goToPhoneStep}
      />

      <div className={`flex flex-col gap-3 border-t border-mist-100 pt-6 sm:flex-row sm:items-center sm:justify-between${phoneStep !== 3 ? ' max-md:hidden' : ''}`}>
        <p className="max-w-xl text-sm leading-6 text-muted">
          Start with the essentials. Jobs, events and course publishing are activated separately through verification and plan access.
        </p>
        <Button type="submit" disabled={pending} className="w-full sm:w-auto max-md:rounded-full">
          {pending ? 'Saving your profile…' : 'Complete profile'}
        </Button>
      </div>
    </form>
  )
}
