'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState, type ReactNode } from 'react'
import { PROFILE_INTENTS, PROFILE_INTENT_LABELS, type Persona, type ProfileIntent } from '../persona'
import { updateProfileGoalsSection, type ProfileInlineActionState } from '../profile-inline-actions'
import { profileIdentityIcon } from '../persona-icons'
import { personaForProfile } from '../profile-persona-rules'
import type { OwnProfile } from '../types'
import { ProfileCardFieldError, ProfileCardForm, useProfileCardEditor } from './profile-card-editing'
import { PersonaDetailFields, PersonaSelect } from './profile-persona-fields'
import { MembershipPanel } from './membership-panel'
import { ProfileSectionEditButton } from './profile-section'

const initialState: ProfileInlineActionState = {}

/**
 * Profile type, its persona details and the goal chips (at least one goal). The same fields and
 * the same server action serve the Profile box on My Profile and the form on Edit profile.
 */
export function ProfileGoalsFields({
  profile,
  fieldErrors,
  onDirty,
}: {
  profile: OwnProfile
  fieldErrors?: Record<string, string[] | undefined>
  onDirty?: () => void
}) {
  const [persona, setPersona] = useState<Persona>(() => personaForProfile(profile))
  const [intents, setIntents] = useState<ProfileIntent[]>(() => (profile.profileIntents?.length ? profile.profileIntents : ['community']))

  function toggleIntent(intent: ProfileIntent) {
    onDirty?.()
    setIntents((current) => (current.includes(intent) ? current.filter((entry) => entry !== intent) : [...current, intent]))
  }

  return (
    <div className="grid gap-4">
      <PersonaSelect persona={persona} onChange={setPersona} fieldErrors={fieldErrors} />
      <PersonaDetailFields persona={persona} profile={profile} fieldErrors={fieldErrors} />
      <fieldset>
        <legend className="text-sm font-semibold text-navy-950">Goals</legend>
        <p className="mt-1 text-xs text-muted">What you are here to do. Choose at least one.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PROFILE_INTENTS.map((intent) => {
            const selected = intents.includes(intent)
            return (
              <button
                key={intent}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleIntent(intent)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                  selected ? 'border-ocean-700 bg-ocean-700 text-white' : 'border-mist-200 bg-white text-navy-900 hover:border-ocean-300'
                }`}
              >
                {selected ? '✓ ' : ''}{PROFILE_INTENT_LABELS[intent]}
              </button>
            )
          })}
        </div>
        <input type="hidden" name="profileIntents" value={JSON.stringify(intents)} />
        {intents.length === 0 ? <p className="mt-1 text-xs font-medium text-red-700">Choose at least one goal.</p> : null}
        <ProfileCardFieldError fieldErrors={fieldErrors} name="profileIntents" />
      </fieldset>
    </div>
  )
}

/** The Edit profile page's profile type & goals form: the same fields and action as the Profile box. */
export function ProfileGoalsPageForm({ profile }: { profile: OwnProfile }) {
  const router = useRouter()

  async function submit(previousState: ProfileInlineActionState, formData: FormData) {
    const nextState = await updateProfileGoalsSection(previousState, formData)
    if (nextState.success) router.push('/profile')
    return nextState
  }

  const [state, formAction, pending] = useActionState(submit, initialState)

  return (
    <ProfileCardForm
      cardId="profile-goals-page"
      label="Profile type & goals"
      action={formAction}
      pending={pending}
      onCancel={() => router.push('/profile')}
      error={state.error}
      submitLabel="Save profile type & goals"
      className="mt-5"
    >
      <ProfileGoalsFields profile={profile} fieldErrors={state.fieldErrors} />
    </ProfileCardForm>
  )
}

function ProfileGoalsBoxEditor({
  profile,
  onClose,
  onDirty,
}: {
  profile: OwnProfile
  onClose: () => void
  onDirty: () => void
}) {
  const router = useRouter()

  async function submit(previousState: ProfileInlineActionState, formData: FormData) {
    const nextState = await updateProfileGoalsSection(previousState, formData)
    if (nextState.success) {
      onClose()
      router.refresh()
    }
    return nextState
  }

  const [state, formAction, pending] = useActionState(submit, initialState)

  return (
    <ProfileCardForm cardId="profile-goals" label="Edit profile type and goals" action={formAction} pending={pending} onCancel={onClose} onDirty={onDirty} error={state.error} className="mt-0">
      <ProfileGoalsFields profile={profile} fieldErrors={state.fieldErrors} onDirty={onDirty} />
    </ProfileCardForm>
  )
}

/** The Profile box of "Access & goals": its pencil edits the profile type, details and goals in place. */
export function ProfileGoalsBox({
  profile,
  children,
}: {
  profile: OwnProfile
  /** The box's read-only content. */
  children: ReactNode
}) {
  const editor = useProfileCardEditor('profile-goals', 'Profile type & goals')
  const icon = profileIdentityIcon(profile)

  return (
    <MembershipPanel
      id="profile-access-identity"
      title="Profile"
      icon={icon}
      // While editing, the box takes the card's full width so the fields have room.
      className={editor.editing ? 'md:col-span-3' : undefined}
      action={editor.editing ? null : (
        <ProfileSectionEditButton label="Edit profile type and goals" onClick={editor.open} buttonRef={editor.triggerRef} className="-mr-1 -mt-1 bg-white" />
      )}
    >
      {editor.editing ? <ProfileGoalsBoxEditor profile={profile} onClose={editor.close} onDirty={editor.markDirty} /> : children}
    </MembershipPanel>
  )
}
