'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'
import { Compass, Gauge, Ship, ShipWheel, Waves, type LucideIcon } from 'lucide-react'
import { updateProfileProfessionalSection, type ProfileInlineActionState } from '../profile-inline-actions'
import type { PublicProfile } from '../types'
import { ProfileField, ProfileFieldList, ProfileSection, ProfileSectionEditButton } from './profile-section'
import { formatYears } from '@/lib/format'

type Detail = { label: string; value: string; icon: LucideIcon }

const initialState: ProfileInlineActionState = {}

function FieldError({ state, name }: { state: ProfileInlineActionState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0]
  return message ? <p className="mt-1 text-xs font-medium text-red-700">{message}</p> : null
}

export function MaritimeProfileCard({ profile, editHref }: { profile: PublicProfile; editHref?: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  async function submitProfessional(previousState: ProfileInlineActionState, formData: FormData) {
    const nextState = await updateProfileProfessionalSection(previousState, formData)
    if (nextState.success) {
      setEditing(false)
      router.refresh()
    }
    return nextState
  }

  const [state, formAction, pending] = useActionState(submitProfessional, initialState)
  const editable = Boolean(editHref)
  const isSeafarer = profile.persona === 'seafarer' || (!profile.persona && profile.profileType === 'seafarer')

  const details: Detail[] = [
    profile.rank ? { label: 'Rank', value: profile.rank, icon: Gauge } : null,
    profile.currentVessel ? { label: 'Current vessel', value: profile.currentVessel, icon: Ship } : null,
    profile.sailingExperienceYears !== null
      ? { label: 'Sailing experience', value: formatYears(profile.sailingExperienceYears), icon: Waves }
      : null,
    profile.vesselTypes.length
      ? { label: 'Vessel types', value: profile.vesselTypes.join(' · '), icon: ShipWheel }
      : null,
    profile.tradingAreas.length
      ? { label: 'Trading areas', value: profile.tradingAreas.join(' · '), icon: Compass }
      : null,
  ].filter((detail): detail is Detail => Boolean(detail))

  if (!isSeafarer) return null
  if (!editable && !details.length) return null

  const inputClass = 'mt-1 min-h-10 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500'
  const labelClass = 'block text-sm font-semibold text-navy-950'

  return (
    <ProfileSection
      id="profile-maritime"
      title="Maritime Experience"
      action={(
        <>
          {profile.shoreCareerPreference && !editing ? (
            <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-semibold text-ocean-700">Open to shore career</span>
          ) : null}
          {editable ? <ProfileSectionEditButton label="Edit Professional Record" onClick={() => setEditing(true)} /> : null}
        </>
      )}
    >
      {editing ? (
        <form action={formAction} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Rank
              <input name="rank" maxLength={100} defaultValue={profile.rank ?? ''} className={inputClass} />
              <FieldError state={state} name="rank" />
            </label>
            <label className={labelClass}>
              Current vessel
              <input name="currentVessel" maxLength={160} defaultValue={profile.currentVessel ?? ''} className={inputClass} />
              <FieldError state={state} name="currentVessel" />
            </label>
            <label className={labelClass}>
              Sailing experience years
              <input name="sailingExperienceYears" type="number" min={0} max={70} defaultValue={profile.sailingExperienceYears?.toString() ?? ''} className={inputClass} />
              <FieldError state={state} name="sailingExperienceYears" />
            </label>
            <label className={labelClass}>
              Vessel types
              <input name="vesselTypes" maxLength={2000} defaultValue={profile.vesselTypes.join(', ')} className={inputClass} />
              <FieldError state={state} name="vesselTypes" />
            </label>
            <label className={labelClass}>
              Trading areas
              <input name="tradingAreas" maxLength={2000} defaultValue={profile.tradingAreas.join(', ')} className={inputClass} />
              <FieldError state={state} name="tradingAreas" />
            </label>
            <label className="flex min-h-10 items-center gap-3 self-end rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950">
              <input name="shoreCareerPreference" type="checkbox" defaultChecked={profile.shoreCareerPreference} />
              Interested in shore opportunities
            </label>
          </div>
          {state.error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:border-ocean-300 hover:bg-mist-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:opacity-60 enabled:hover:bg-navy-800 transition-colors disabled:cursor-not-allowed">
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      ) : details.length ? (
        <ProfileFieldList className="mt-5">
          {details.map(({ label, value, icon }) => (
            <ProfileField key={label} label={label} icon={icon}>{value}</ProfileField>
          ))}
        </ProfileFieldList>
      ) : (
        <p className="mt-4 text-sm text-muted">Add your rank, sea service, vessel types and trading areas.</p>
      )}
    </ProfileSection>
  )
}
