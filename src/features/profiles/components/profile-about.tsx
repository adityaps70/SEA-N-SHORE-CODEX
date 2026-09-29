'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'
import { updateProfileAboutSection, type ProfileInlineActionState } from '../profile-inline-actions'
import type { PublicProfile } from '../types'
import { ProfileSection, ProfileSectionEditButton, profileFieldLabelClass } from './profile-section'

const initialState: ProfileInlineActionState = {}
const PHONE_SUMMARY_CLAMP_CHARS = 220

function FieldError({ state, name }: { state: ProfileInlineActionState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0]
  return message ? <p className="mt-1 text-xs font-medium text-red-700">{message}</p> : null
}

export function ProfileAbout({ profile, editHref }: { profile: PublicProfile; editHref?: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  async function submitAbout(previousState: ProfileInlineActionState, formData: FormData) {
    const nextState = await updateProfileAboutSection(previousState, formData)
    if (nextState.success) {
      setEditing(false)
      router.refresh()
    }
    return nextState
  }

  const [state, formAction, pending] = useActionState(submitAbout, initialState)
  const editable = Boolean(editHref)
  /** Long introductions show four lines and a "…more" toggle on phones. */
  const clampOnPhones = (profile.summary?.length ?? 0) > PHONE_SUMMARY_CLAMP_CHARS || (profile.summary?.split('\n').length ?? 0) > 4

  if (!editable && !profile.summary && profile.skills.length === 0) return null

  return (
    <ProfileSection
      id="profile-about"
      title="About"
      action={editable ? <ProfileSectionEditButton label="Edit About" onClick={() => setEditing(true)} /> : null}
    >
      {editing ? (
        <form action={formAction} className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-navy-950">
            About
            <textarea
              name="summary"
              required
              maxLength={2000}
              defaultValue={profile.summary ?? ''}
              className="mt-1 min-h-32 w-full rounded-xl border border-mist-100 bg-white px-3 py-3 text-sm leading-6 text-ink outline-none focus:border-ocean-500"
            />
            <FieldError state={state} name="summary" />
          </label>
          <label className="block text-sm font-semibold text-navy-950">
            Skills
            <input
              name="skills"
              maxLength={2000}
              defaultValue={profile.skills.join(', ')}
              className="mt-1 min-h-10 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500"
            />
            <FieldError state={state} name="skills" />
          </label>
          {state.error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:border-ocean-300 hover:bg-mist-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:opacity-60 enabled:hover:bg-navy-800 transition-colors disabled:cursor-not-allowed">
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
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
