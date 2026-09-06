'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Card } from '@/components/ui/card'
import { updateProfile, type OnboardingFormValues, type ProfileActionState } from '../actions'
import type { OwnProfile } from '../types'

const initialState: ProfileActionState = {}

function FieldError({ state, name }: { state: ProfileActionState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0]
  return message ? <p className="mt-1 text-sm text-red-700">{message}</p> : null
}

export function ProfileEditForm({ profile }: { profile: OwnProfile }) {
  const [state, formAction, pending] = useActionState(updateProfile, initialState)
  const values = state.values
  const isMaritime = profile.profileType === 'seafarer' || profile.profileType === 'maritime_professional'

  function textValue(name: keyof OnboardingFormValues, fallback = '') {
    const value = values?.[name]
    return typeof value === 'string' ? value : fallback
  }

  const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500'
  const textareaClass = `${inputClass} min-h-28 py-3`
  const labelClass = 'block text-sm font-semibold text-navy-950'

  return (
    <Card className="border border-mist-100 p-5 sm:p-6">
      <form key={state.revision ?? 0} action={formAction} className="space-y-6">
        <input type="hidden" name="profileType" value={profile.profileType} />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Full name
            <input name="fullName" required maxLength={120} defaultValue={textValue('fullName', profile.fullName)} className={inputClass} />
            <FieldError state={state} name="fullName" />
          </label>
          <label className={labelClass}>
            Profile address
            <input name="slug" required maxLength={80} defaultValue={textValue('slug', profile.slug)} className={inputClass} />
            <FieldError state={state} name="slug" />
          </label>
          <label className={labelClass}>
            Location
            <input name="location" maxLength={120} defaultValue={textValue('location', profile.location ?? '')} className={inputClass} />
            <FieldError state={state} name="location" />
          </label>
          <label className={labelClass}>
            Headline
            <input name="headline" required maxLength={160} defaultValue={textValue('headline', profile.headline ?? '')} className={inputClass} />
            <FieldError state={state} name="headline" />
          </label>
        </div>

        <label className={labelClass}>
          About
          <textarea name="summary" required maxLength={2000} defaultValue={textValue('summary', profile.summary ?? '')} className={textareaClass} />
          <FieldError state={state} name="summary" />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Contact visibility
            <select name="contactVisibility" defaultValue={values?.contactVisibility ?? profile.contactVisibility} className={inputClass}>
              <option value="private">Private</option>
              <option value="members">Members</option>
              <option value="public">Public</option>
            </select>
            <FieldError state={state} name="contactVisibility" />
          </label>
          <label className={labelClass}>
            Skills
            <input name="skills" maxLength={2000} defaultValue={textValue('skills', profile.skills.join(', '))} className={inputClass} />
            <FieldError state={state} name="skills" />
          </label>
        </div>

        {isMaritime ? (
          <fieldset className="rounded-2xl border border-mist-100 bg-mist-50/50 p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold text-navy-950">Maritime details</legend>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Rank
                <input name="rank" maxLength={100} defaultValue={textValue('rank', profile.rank ?? '')} className={inputClass} />
                <FieldError state={state} name="rank" />
              </label>
              <label className={labelClass}>
                Current company
                <input name="currentCompany" maxLength={160} defaultValue={textValue('currentCompany', profile.currentCompany ?? '')} className={inputClass} />
                <FieldError state={state} name="currentCompany" />
              </label>
              <label className={labelClass}>
                Current vessel
                <input name="currentVessel" maxLength={160} defaultValue={textValue('currentVessel', profile.currentVessel ?? '')} className={inputClass} />
                <FieldError state={state} name="currentVessel" />
              </label>
              <label className={labelClass}>
                Sailing experience years
                <input name="sailingExperienceYears" type="number" min={0} max={70} defaultValue={textValue('sailingExperienceYears', profile.sailingExperienceYears?.toString() ?? '')} className={inputClass} />
                <FieldError state={state} name="sailingExperienceYears" />
              </label>
              <label className={labelClass}>
                Vessel types
                <input name="vesselTypes" maxLength={2000} defaultValue={textValue('vesselTypes', profile.vesselTypes.join(', '))} className={inputClass} />
                <FieldError state={state} name="vesselTypes" />
              </label>
              <label className={labelClass}>
                Trading areas
                <input name="tradingAreas" maxLength={2000} defaultValue={textValue('tradingAreas', profile.tradingAreas.join(', '))} className={inputClass} />
                <FieldError state={state} name="tradingAreas" />
              </label>
              <label className={labelClass}>
                Availability
                <input name="availability" maxLength={100} defaultValue={textValue('availability', profile.availability ?? '')} className={inputClass} />
                <FieldError state={state} name="availability" />
              </label>
              <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950">
                <input
                  name="shoreCareerPreference"
                  type="checkbox"
                  defaultChecked={typeof values?.shoreCareerPreference === 'boolean' ? values.shoreCareerPreference : profile.shoreCareerPreference}
                />
                Interested in shore opportunities
              </label>
            </div>
          </fieldset>
        ) : null}

        {state.error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}

        <div className="flex flex-wrap justify-end gap-3 border-t border-mist-100 pt-4">
          <Link href="/profile" className="inline-flex min-h-11 items-center rounded-xl border border-mist-100 bg-white px-4 text-sm font-semibold text-navy-950 hover:border-ocean-500">
            Cancel
          </Link>
          <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700 disabled:cursor-not-allowed disabled:opacity-60">
            {pending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Card>
  )
}
