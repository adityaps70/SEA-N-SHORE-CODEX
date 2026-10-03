'use client'

import { useRouter } from 'next/navigation'
import { useActionState } from 'react'
import { Compass, Gauge, Ship, ShipWheel, Waves, type LucideIcon } from 'lucide-react'
import { updateProfileProfessionalSection, type ProfileInlineActionState } from '../profile-inline-actions'
import type { PublicProfile } from '../types'
import { ProfileCardFieldError, ProfileCardForm, profileCardInputClass, profileCardLabelClass, useProfileCardEditor } from './profile-card-editing'
import { ProfileField, ProfileFieldList, ProfileSection, ProfileSectionEditButton } from './profile-section'
import { formatYears } from '@/lib/format'

type Detail = { label: string; value: string; icon: LucideIcon }

const initialState: ProfileInlineActionState = {}

/** Maritime Experience's edit form: rank, vessel, sailing years, vessel types, trading areas, shore preference. */
function MaritimeProfileEditor({
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
  async function submitProfessional(previousState: ProfileInlineActionState, formData: FormData) {
    const nextState = await updateProfileProfessionalSection(previousState, formData)
    if (nextState.success) onSaved()
    return nextState
  }

  const [state, formAction, pending] = useActionState(submitProfessional, initialState)
  const inputClass = profileCardInputClass
  const labelClass = profileCardLabelClass

  return (
    <ProfileCardForm cardId="profile-maritime" label="Edit Professional Record" action={formAction} pending={pending} onCancel={onClose} onDirty={onDirty} error={state.error} className="mt-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Rank
          <input name="rank" maxLength={100} defaultValue={profile.rank ?? ''} className={inputClass} />
          <ProfileCardFieldError fieldErrors={state.fieldErrors} name="rank" />
        </label>
        <label className={labelClass}>
          Current vessel
          <input name="currentVessel" maxLength={160} defaultValue={profile.currentVessel ?? ''} className={inputClass} />
          <ProfileCardFieldError fieldErrors={state.fieldErrors} name="currentVessel" />
        </label>
        <label className={labelClass}>
          Sailing experience years
          <input name="sailingExperienceYears" type="number" min={0} max={70} defaultValue={profile.sailingExperienceYears?.toString() ?? ''} className={inputClass} />
          <ProfileCardFieldError fieldErrors={state.fieldErrors} name="sailingExperienceYears" />
        </label>
        <label className={labelClass}>
          Vessel types
          <input name="vesselTypes" maxLength={2000} defaultValue={profile.vesselTypes.join(', ')} className={inputClass} />
          <ProfileCardFieldError fieldErrors={state.fieldErrors} name="vesselTypes" />
        </label>
        <label className={labelClass}>
          Trading areas
          <input name="tradingAreas" maxLength={2000} defaultValue={profile.tradingAreas.join(', ')} className={inputClass} />
          <ProfileCardFieldError fieldErrors={state.fieldErrors} name="tradingAreas" />
        </label>
        <label className="flex min-h-10 items-center gap-3 self-end rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950">
          <input name="shoreCareerPreference" type="checkbox" defaultChecked={profile.shoreCareerPreference} />
          Interested in shore opportunities
        </label>
      </div>
    </ProfileCardForm>
  )
}

export function MaritimeProfileCard({ profile, editHref }: { profile: PublicProfile; editHref?: string }) {
  const router = useRouter()
  const { editing: editorEditing, open: openEditor, close: closeEditor, markDirty: markEditorDirty, triggerRef: editorTriggerRef } = useProfileCardEditor('profile-maritime', 'Maritime Experience')
  const editable = Boolean(editHref)
  const editing = editable && editorEditing
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

  return (
    <ProfileSection
      id="profile-maritime"
      title="Maritime Experience"
      action={(
        <>
          {profile.shoreCareerPreference && !editing ? (
            <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-semibold text-ocean-700">Open to shore career</span>
          ) : null}
          {editable && !editing ? <ProfileSectionEditButton label="Edit Professional Record" onClick={openEditor} buttonRef={editorTriggerRef} /> : null}
        </>
      )}
    >
      {editing ? (
        <MaritimeProfileEditor
          profile={profile}
          onClose={closeEditor}
          onDirty={markEditorDirty}
          onSaved={() => {
            closeEditor()
            router.refresh()
          }}
        />
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
