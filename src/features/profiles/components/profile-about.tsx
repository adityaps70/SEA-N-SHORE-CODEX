'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'
import { updateProfileAboutSection, type ProfileInlineActionState } from '../profile-inline-actions'
import type { PublicProfile } from '../types'
import { ProfileCardFieldError, ProfileCardForm, profileCardInputClass, profileCardLabelClass, useProfileCardEditor } from './profile-card-editing'
import { ProfileSection, ProfileSectionEditButton, profileFieldLabelClass } from './profile-section'

const initialState: ProfileInlineActionState = {}
const PHONE_SUMMARY_CLAMP_CHARS = 220

/** About's edit form: the summary and the skills, the two things the card shows. */
function ProfileAboutEditor({
  profile,
  onClose,
  onSaved,
  onDirty,
}: {
  profile: PublicProfile
  onClose: () => void
  onSaved: () => void
  onDirty: () => void
}) {
  async function submitAbout(previousState: ProfileInlineActionState, formData: FormData) {
    const nextState = await updateProfileAboutSection(previousState, formData)
    if (nextState.success) onSaved()
    return nextState
  }

  const [state, formAction, pending] = useActionState(submitAbout, initialState)

  return (
    <ProfileCardForm cardId="profile-about" label="Edit About" action={formAction} pending={pending} onCancel={onClose} onDirty={onDirty} error={state.error} className="space-y-4">
      <label className={profileCardLabelClass}>
        About
        <textarea
          name="summary"
          required
          maxLength={2000}
          defaultValue={profile.summary ?? ''}
          className={`${profileCardInputClass} min-h-32 py-3 leading-6`}
        />
        <ProfileCardFieldError fieldErrors={state.fieldErrors} name="summary" />
      </label>
      <label className={profileCardLabelClass}>
        Skills
        <input name="skills" maxLength={2000} defaultValue={profile.skills.join(', ')} placeholder="Separate skills with commas" className={profileCardInputClass} />
        <ProfileCardFieldError fieldErrors={state.fieldErrors} name="skills" />
      </label>
    </ProfileCardForm>
  )
}

export function ProfileAbout({ profile, editHref }: { profile: PublicProfile; editHref?: string }) {
  const router = useRouter()
  const editor = useProfileCardEditor('profile-about', 'About')
  const [expanded, setExpanded] = useState(false)
  const editable = Boolean(editHref)
  const editing = editable && editor.editing
  /** Long introductions show four lines and a "…more" toggle on phones. */
  const clampOnPhones = (profile.summary?.length ?? 0) > PHONE_SUMMARY_CLAMP_CHARS || (profile.summary?.split('\n').length ?? 0) > 4

  if (!editable && !profile.summary && profile.skills.length === 0) return null

  return (
    <ProfileSection
      id="profile-about"
      title="About"
      action={editable && !editing ? <ProfileSectionEditButton label="Edit About" onClick={editor.open} buttonRef={editor.triggerRef} /> : null}
    >
      {editing ? (
        <ProfileAboutEditor
          profile={profile}
          onClose={editor.close}
          onDirty={editor.markDirty}
          onSaved={() => {
            editor.close()
            router.refresh()
          }}
        />
      ) : (
        <>
          {profile.summary ? (
            <>
              <p className={`mt-3 whitespace-pre-line text-sm leading-7 text-ink max-md:text-[15px] max-md:leading-6 ${clampOnPhones && !expanded ? 'max-md:line-clamp-4' : ''}`}>{profile.summary}</p>
              {clampOnPhones ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                  className="mt-1 min-h-11 cursor-pointer text-[15px] font-semibold text-muted hover:text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600 md:hidden"
                >
                  {expanded ? 'Show less' : '…more'}
                </button>
              ) : null}
            </>
          ) : (
            editable ? <p className="mt-3 text-sm text-muted">Add a short professional introduction.</p> : null
          )}
          {profile.skills.length ? (
            <div className="mt-5">
              <h3 className={profileFieldLabelClass}>Skills</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {profile.skills.map((skill) => (
                  <span key={skill} className="rounded-full bg-mist-50 px-3 py-1.5 text-sm font-medium text-navy-900">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </ProfileSection>
  )
}
