'use client'

/* eslint-disable @next/next/no-img-element */
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useActionState, useState } from 'react'
import { Anchor, MapPin, Pencil, Ship, TimerReset } from 'lucide-react'
import { updateProfileIdentitySection, type ProfileInlineActionState } from '../profile-inline-actions'
import { profileAvailabilityLabel } from '../profile-availability'
import type { ContactVisibility, PublicProfile } from '../types'

const profileTypeLabels: Record<PublicProfile['profileType'], string> = {
  seafarer: 'Seafarer',
  maritime_professional: 'Maritime Professional',
  company: 'Company',
  trainer: 'Trainer',
  mentor: 'Mentor',
  recruiter: 'Recruiter',
  service_provider: 'Maritime Service Provider',
}

const initialState: ProfileInlineActionState = {}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function FieldError({ state, name }: { state: ProfileInlineActionState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0]
  return message ? <p className="mt-1 text-xs font-medium text-red-700">{message}</p> : null
}

export function ProfileHeader({
  profile,
  actions,
  editHref,
  mediaControls,
  avatarControls,
  contactVisibility = 'members',
}: {
  profile: PublicProfile
  actions?: ReactNode
  editHref?: string
  mediaControls?: ReactNode
  avatarControls?: ReactNode
  contactVisibility?: ContactVisibility
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  async function submitIdentity(previousState: ProfileInlineActionState, formData: FormData) {
    const nextState = await updateProfileIdentitySection(previousState, formData)
    if (nextState.success) {
      setEditing(false)
      router.refresh()
    }
    return nextState
  }

  const [state, formAction, pending] = useActionState(submitIdentity, initialState)
  const identityLabel = profile.primaryIdentity ?? profileTypeLabels[profile.profileType]
  const secondaryIdentities = profile.secondaryIdentities ?? []
  const availabilityLabel = profileAvailabilityLabel(profile.availability)
  const inputClass = 'mt-1 min-h-10 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500'
  const labelClass = 'block text-sm font-semibold text-navy-950'

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
      <div className="relative h-36 overflow-hidden bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))] sm:h-48">
        {profile.coverUrl ? (
          <img
            src={profile.coverUrl}
            alt={`${profile.fullName} cover photo`}
            className="h-full w-full object-cover"
          />
        ) : null}
        {mediaControls ? <div className="absolute right-4 top-4 z-10">{mediaControls}</div> : null}
      </div>

      <div className="px-5 pb-6 sm:px-8 sm:pb-8">
        <div className="-mt-12 grid gap-5 sm:-mt-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="flex min-w-0 items-end gap-4">
            <div className="relative shrink-0">
              <div className="grid size-24 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-mist-100 text-xl font-semibold text-navy-950 shadow-sm sm:size-28 sm:text-2xl">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={`${profile.fullName} profile photo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials(profile.fullName)
                )}
              </div>
              {avatarControls ? <div className="absolute -bottom-1 -right-1 z-10">{avatarControls}</div> : null}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-mist-50 px-2.5 py-1 text-xs font-semibold text-ocean-700">
                <Anchor aria-hidden="true" className="size-3.5" />
                {identityLabel}
              </span>
              <div className="mt-2 flex min-w-0 items-center gap-2">
                <h1 className="min-w-0 break-words text-2xl font-semibold leading-tight tracking-[-.03em] text-navy-950 sm:text-3xl">
                  {profile.fullName}
                </h1>
                {editHref ? (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Edit basic information"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-mist-100 text-navy-950 hover:border-ocean-500 hover:text-ocean-700"
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </div>
              {secondaryIdentities.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {secondaryIdentities.map((identity) => (
                    <span key={identity} className="rounded-full bg-ocean-50 px-2.5 py-1 text-xs font-medium text-ocean-800">
                      {identity}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div
            data-testid="profile-header-actions"
            className="flex min-w-0 flex-col items-start gap-3 lg:items-end lg:justify-self-end"
          >
            {availabilityLabel ? (
              <span className="inline-flex w-fit items-center gap-2 rounded-xl border border-mist-100 bg-mist-50 px-3 py-2 text-sm font-medium text-navy-900">
                <TimerReset aria-hidden="true" className="size-4 text-teal-500" />
                {availabilityLabel}
              </span>
            ) : null}
            {actions ? <div className="w-full lg:w-auto">{actions}</div> : null}
          </div>
        </div>

        {editing ? (
          <form action={formAction} className="mt-6 rounded-2xl border border-ocean-100 bg-ocean-50/40 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Full name
                <input name="fullName" required maxLength={120} defaultValue={profile.fullName} className={inputClass} />
                <FieldError state={state} name="fullName" />
              </label>
              <label className={labelClass}>
                Profile address
                <input name="slug" required maxLength={80} defaultValue={profile.slug} className={inputClass} />
                <FieldError state={state} name="slug" />
              </label>
              <label className={labelClass}>
                Location
                <input name="location" maxLength={120} defaultValue={profile.location ?? ''} className={inputClass} />
                <FieldError state={state} name="location" />
              </label>
              <label className={labelClass}>
                Headline
                <input name="headline" required maxLength={160} defaultValue={profile.headline ?? ''} className={inputClass} />
                <FieldError state={state} name="headline" />
              </label>
              <label className={labelClass}>
                Current company
                <input name="currentCompany" maxLength={160} defaultValue={profile.currentCompany ?? ''} className={inputClass} />
                <FieldError state={state} name="currentCompany" />
              </label>
              <label className={labelClass}>
                Contact visibility
                <select name="contactVisibility" defaultValue={contactVisibility} className={inputClass}>
                  <option value="private">Private</option>
                  <option value="members">Members only</option>
                  <option value="public">Public</option>
                </select>
                <FieldError state={state} name="contactVisibility" />
              </label>
            </div>
            {state.error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
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
            {profile.headline ? (
              <p className="mt-5 max-w-3xl text-base font-medium leading-7 text-ink sm:text-lg">{profile.headline}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {profile.location ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin aria-hidden="true" className="size-4" />
                  {profile.location}
                </span>
              ) : null}
              {profile.currentCompany ? (
                <span className="inline-flex items-center gap-1.5">
                  <Ship aria-hidden="true" className="size-4" />
                  {profile.currentCompany}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
