'use client'

import { useActionState, useMemo, useState } from 'react'
import { FormErrorSummary } from '@/components/ui/form-error-summary'
import { updateProfilePreferences, type ProfileActionState } from '../actions'
import {
  PERSONAS,
  PROFILE_INTENTS,
  PERSONA_LABELS,
  PROFILE_INTENT_LABELS,
  personaUsesProfessionalCompany,
  type Persona,
  type ProfileIntent,
} from '../persona'
import type { OwnProfile } from '../types'

const initialState: ProfileActionState = {}

function parseStateIntents(value?: string): ProfileIntent[] | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((entry): entry is ProfileIntent =>
      typeof entry === 'string' && PROFILE_INTENTS.includes(entry as ProfileIntent))
  } catch {
    return null
  }
}

export function ProfilePreferencesForm({ profile }: { profile: OwnProfile }) {
  const [state, formAction, pending] = useActionState(updateProfilePreferences, initialState)
  const initialPersona = state.values?.persona ?? profile.persona ?? (
    profile.profileType === 'seafarer'
      ? 'seafarer'
      : profile.profileType === 'recruiter'
        ? 'recruiter_hr'
        : profile.profileType === 'trainer'
          ? 'trainer_instructor'
          : 'shore_professional'
  )
  const stateIntents = parseStateIntents(state.values?.profileIntents)
  const initialIntents = useMemo(
    () => stateIntents ?? (profile.profileIntents.length ? profile.profileIntents : ['community']),
    [profile.profileIntents, stateIntents],
  )
  const [persona, setPersona] = useState<Persona>(initialPersona)
  const [intents, setIntents] = useState<ProfileIntent[]>(initialIntents)

  function toggleIntent(intent: ProfileIntent) {
    setIntents((current) =>
      current.includes(intent)
        ? current.filter((entry) => entry !== intent)
        : [...current, intent],
    )
  }

  const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500'
  const fieldError = (name: string) => state.fieldErrors?.[name]?.[0]

  return (
    <form action={formAction} className="space-y-5">
      <FormErrorSummary
        error={state.error}
        fieldErrors={state.fieldErrors}
        fieldLabels={{
          persona: 'Profile type',
          profileIntents: 'What you are here to do',
          currentCompany: 'Current organization',
          specialization: 'Specialization',
          institutionName: 'Institute / academy',
          familyRelationship: 'Relationship',
          rank: 'Rank',
        }}
      />

      <section className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-ocean-700">Sea N Shore identity</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Profile type & goals</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          These are the same profile preferences used during onboarding. They personalize Sea N Shore but do not grant paid publishing permissions.
        </p>

        <label className="mt-5 block text-sm font-semibold text-navy-950">
          Which best describes you?
          <select
            name="persona"
            value={persona}
            onChange={(event) => setPersona(event.target.value as Persona)}
            className={inputClass}
          >
            {PERSONAS.map((entry) => <option key={entry} value={entry}>{PERSONA_LABELS[entry]}</option>)}
          </select>
          {fieldError('persona') ? <span className="mt-1 block text-xs text-red-700">{fieldError('persona')}</span> : null}
        </label>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-navy-950">What are you here to do?</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {PROFILE_INTENTS.map((intent) => {
              const selected = intents.includes(intent)
              return (
                <button
                  key={intent}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleIntent(intent)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                    selected
                      ? 'border-ocean-700 bg-ocean-700 text-white'
                      : 'border-mist-100 bg-mist-50 text-navy-900 hover:border-ocean-300'
                  }`}
                >
                  {selected ? '✓ ' : ''}{PROFILE_INTENT_LABELS[intent]}
                </button>
              )
            })}
          </div>
          {fieldError('profileIntents') ? <span className="mt-2 block text-xs text-red-700">{fieldError('profileIntents')}</span> : null}
        </fieldset>

        <input type="hidden" name="profileIntents" value={JSON.stringify(intents)} />

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {persona === 'seafarer' ? (
            <label className="text-sm font-semibold text-navy-950">
              Current or most recent rank
              <input name="rank" maxLength={100} defaultValue={state.values?.rank ?? profile.rank ?? ''} className={inputClass} />
              {fieldError('rank') ? <span className="mt-1 block text-xs text-red-700">{fieldError('rank')}</span> : null}
            </label>
          ) : null}

          {personaUsesProfessionalCompany(persona) ? (
            <label className="text-sm font-semibold text-navy-950">
              Current organization
              <input name="currentCompany" maxLength={160} defaultValue={state.values?.currentCompany ?? profile.currentCompany ?? ''} className={inputClass} />
              {fieldError('currentCompany') ? <span className="mt-1 block text-xs text-red-700">{fieldError('currentCompany')}</span> : null}
            </label>
          ) : null}

          {persona === 'trainer_instructor' ? (
            <label className="text-sm font-semibold text-navy-950">
              Training specialization
              <input name="specialization" maxLength={500} defaultValue={state.values?.specialization ?? profile.specialization ?? ''} className={inputClass} />
              {fieldError('specialization') ? <span className="mt-1 block text-xs text-red-700">{fieldError('specialization')}</span> : null}
            </label>
          ) : null}

          {persona === 'student_cadet' ? (
            <label className="text-sm font-semibold text-navy-950">
              Institute / academy
              <input name="institutionName" maxLength={160} defaultValue={state.values?.institutionName ?? profile.institutionName ?? ''} className={inputClass} />
              {fieldError('institutionName') ? <span className="mt-1 block text-xs text-red-700">{fieldError('institutionName')}</span> : null}
            </label>
          ) : null}

          {persona === 'seafarer_family' ? (
            <label className="text-sm font-semibold text-navy-950">
              Relationship to the maritime community
              <input name="familyRelationship" maxLength={80} defaultValue={state.values?.familyRelationship ?? profile.communityRelationship ?? ''} className={inputClass} />
              {fieldError('familyRelationship') ? <span className="mt-1 block text-xs text-red-700">{fieldError('familyRelationship')}</span> : null}
            </label>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={pending || intents.length === 0}
            className="inline-flex min-h-11 items-center rounded-xl bg-navy-950 px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save profile type & goals'}
          </button>
        </div>
      </section>
    </form>
  )
}
