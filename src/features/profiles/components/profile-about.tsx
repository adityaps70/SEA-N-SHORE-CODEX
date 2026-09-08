'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { updateProfileAboutSection, type ProfileInlineActionState } from '../profile-inline-actions'
import type { PublicProfile } from '../types'

const initialState: ProfileInlineActionState = {}

function FieldError({ state, name }: { state: ProfileInlineActionState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0]
  return message ? <p className="mt-1 text-xs font-medium text-red-700">{message}</p> : null
}

export function ProfileAbout({ profile, editHref }: { profile: PublicProfile; editHref?: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)

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

  if (!editable && !profile.summary && profile.skills.length === 0) return null

  return (
    <Card className="border border-mist-100 p-5 sm:p-7">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-navy-950">About</h2>
        {editable ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit About"
            className="inline-flex size-9 items-center justify-center rounded-full border border-mist-100 text-navy-950 hover:border-ocean-500 hover:text-ocean-700"
          >
            <Pencil aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>

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
            <button type="button" onClick={() => setEditing(false)} className="min-h-10 rounded-xl border border-mist-100 bg-white px-4 text-sm font-semibold text-navy-950">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : (
        <>
          {profile.summary ? (
            <p className="mt-3 whitespace-pre-line leading-7 text-muted">{profile.summary}</p>
          ) : (
            editable ? <p className="mt-3 text-sm text-muted">Add a short professional introduction.</p> : null
          )}
          {profile.skills.length ? (
            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Expertise</p>
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
    </Card>
  )
}
