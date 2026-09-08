'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'
import { BriefcaseBusiness, Compass, Gauge, Pencil, Ship, TimerReset, Waves } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { updateProfileProfessionalSection, type ProfileInlineActionState } from '../profile-inline-actions'
import { normalizeProfileAvailability, profileAvailabilityLabel } from '../profile-availability'
import type { PublicProfile } from '../types'

type Detail = { label: string; value: string; icon: typeof Ship }

const initialState: ProfileInlineActionState = {}

function FieldError({ state, name }: { state: ProfileInlineActionState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0]
  return message ? <p className="mt-1 text-xs font-medium text-red-700">{message}</p> : null
}

export function MaritimeProfileCard({ profile, editHref }: { profile: PublicProfile; editHref?: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [state, formAction, pending] = useActionState(updateProfileProfessionalSection, initialState)
  const editable = Boolean(editHref)
  const availabilityLabel = profileAvailabilityLabel(profile.availability)

  useEffect(() => {
    if (!state.success) return
    setEditing(false)
    router.refresh()
  }, [router, state.revision, state.success])

  const details: Detail[] = [
    profile.rank ? { label: 'Rank', value: profile.rank, icon: Gauge } : null,
    profile.currentVessel ? { label: 'Current vessel', value: profile.currentVessel, icon: Ship } : null,
    profile.sailingExperienceYears !== null
      ? { label: 'Sailing experience', value: `${profile.sailingExperienceYears} years`, icon: Waves }
      : null,
    profile.vesselTypes.length
      ? { label: 'Vessel types', value: profile.vesselTypes.join(' · '), icon: BriefcaseBusiness }
      : null,
    profile.tradingAreas.length
      ? { label: 'Trading areas', value: profile.tradingAreas.join(' · '), icon: Compass }
      : null,
    availabilityLabel ? { label: 'Availability', value: availabilityLabel, icon: TimerReset } : null,
  ].filter((detail): detail is Detail => Boolean(detail))

  if (!editable && !details.length) return null

  const inputClass = 'mt-1 min-h-10 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500'
  const labelClass = 'block text-sm font-semibold text-navy-950'

  return (
    <Card className="border border-mist-100 p-5 sm:p-7">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Professional record</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-navy-950">Maritime experience</h2>
        </div>
        <div className="flex items-center gap-2">
          {profile.shoreCareerPreference && !editing ? (
            <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-semibold text-ocean-700">Open to shore career</span>
          ) : null}
          {editable ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit Professional Record"
              className="inline-flex size-9 items-center justify-center rounded-full border border-mist-100 text-navy-950 hover:border-ocean-500 hover:text-ocean-700"
            >
              <Pencil aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

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
            <label className={labelClass}>
              Availability
              <select name="availability" defaultValue={normalizeProfileAvailability(profile.availability)} className={inputClass}>
                <option value="onboard">Onboard</option>
                <option value="ashore">Ashore</option>
              </select>
              <FieldError state={state} name="availability" />
            </label>
            <label className="flex min-h-10 items-center gap-3 self-end rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950">
              <input name="shoreCareerPreference" type="checkbox" defaultChecked={profile.shoreCareerPreference} />
              Interested in shore opportunities
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
      ) : details.length ? (
        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          {details.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl border border-mist-100 bg-mist-50/60 p-4">
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.11em] text-muted">
                <Icon aria-hidden="true" className="size-4 text-ocean-700" />
                {label}
              </dt>
              <dd className="mt-2 text-sm font-semibold leading-6 text-navy-950">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-sm text-muted">Add your maritime experience and current status.</p>
      )}
    </Card>
  )
}
