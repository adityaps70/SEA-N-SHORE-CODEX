'use client'

import { PERSONAS, PERSONA_LABELS, type Persona } from '../persona'
import { personaDetailFields, rankFieldLabel } from '../profile-persona-rules'
import type { PublicProfile } from '../types'
import { OrganizationPicker, type PickerOrganization } from './organization-picker'
import { ProfileCardFieldError, profileCardInputClass, profileCardLabelClass } from './profile-card-editing'

type FieldErrors = Record<string, string[] | undefined> | undefined

/** "Profile type": the persona shown as the badge in the header and in Access & goals. */
export function PersonaSelect({
  persona,
  onChange,
  fieldErrors,
}: {
  persona: Persona
  onChange: (persona: Persona) => void
  fieldErrors?: FieldErrors
}) {
  return (
    <label className={profileCardLabelClass}>
      Profile type
      <select name="persona" value={persona} onChange={(event) => onChange(event.target.value as Persona)} className={profileCardInputClass}>
        {PERSONAS.map((entry) => <option key={entry} value={entry}>{PERSONA_LABELS[entry]}</option>)}
      </select>
      <ProfileCardFieldError fieldErrors={fieldErrors} name="persona" />
    </label>
  )
}

/**
 * The persona details, shown live as the profile type changes, the same way onboarding does:
 * rank for Seafarer, institute for Student / Cadet, relationship for Seafarer Family,
 * specialization for Trainer, organization for working personas. A value that is already saved
 * always stays visible and editable (round 10). Organisation accounts never get organization or rank.
 */
export function PersonaDetailFields({
  persona,
  profile,
  fieldErrors,
  registeredOrganization = null,
  fields = ['company', 'rank', 'institution', 'relationship', 'specialization'],
}: {
  persona: Persona
  profile: PublicProfile
  fieldErrors?: FieldErrors
  /** An organization the member just registered from the picker, to link. */
  registeredOrganization?: PickerOrganization | null
  fields?: Array<'company' | 'rank' | 'institution' | 'relationship' | 'specialization'>
}) {
  const visible = personaDetailFields(persona, {
    rank: profile.rank,
    currentCompany: profile.currentCompany,
    hasLinkedOrganization: Boolean(profile.currentOrganization),
    institutionName: profile.institutionName,
    communityRelationship: profile.communityRelationship,
    specialization: profile.specialization,
  }, { organisationAccount: profile.identityRoot === 'organisation' })
  const show = (field: (typeof fields)[number]) => fields.includes(field) && visible[field]
  const rankRequired = persona === 'seafarer'

  return (
    <>
      {show('company') ? (
        <OrganizationPicker
          label="Current organization"
          defaultName={registeredOrganization?.name ?? profile.currentCompany ?? ''}
          defaultOrganization={registeredOrganization ?? profile.currentOrganization ?? null}
          error={fieldErrors?.currentCompany?.[0] ?? fieldErrors?.currentCompanyId?.[0]}
          labelClassName={profileCardLabelClass}
          inputClassName={profileCardInputClass}
          returnTo="/profile"
        />
      ) : null}
      {show('rank') ? (
        <label className={profileCardLabelClass}>
          {rankFieldLabel(persona)}
          <input
            name="rank"
            maxLength={100}
            required={rankRequired}
            defaultValue={profile.rank ?? ''}
            className={profileCardInputClass}
            aria-describedby="profile-card-rank-hint"
          />
          <span id="profile-card-rank-hint" className="mt-1 block text-xs font-normal text-muted">
            {rankRequired ? 'Shown next to your name on posts.' : 'Shown next to your name on posts. Clear it if it no longer applies.'}
          </span>
          <ProfileCardFieldError fieldErrors={fieldErrors} name="rank" />
        </label>
      ) : null}
      {show('institution') ? (
        <label className={profileCardLabelClass}>
          Institute / academy
          <input name="institutionName" maxLength={160} defaultValue={profile.institutionName ?? ''} className={profileCardInputClass} />
          <ProfileCardFieldError fieldErrors={fieldErrors} name="institutionName" />
        </label>
      ) : null}
      {show('relationship') ? (
        <label className={profileCardLabelClass}>
          Relationship to the maritime community
          <input name="familyRelationship" maxLength={80} defaultValue={profile.communityRelationship ?? ''} className={profileCardInputClass} />
          <ProfileCardFieldError fieldErrors={fieldErrors} name="familyRelationship" />
        </label>
      ) : null}
      {show('specialization') ? (
        <label className={profileCardLabelClass}>
          Training specialization
          <input name="specialization" maxLength={500} defaultValue={profile.specialization ?? ''} className={profileCardInputClass} />
          <ProfileCardFieldError fieldErrors={fieldErrors} name="specialization" />
        </label>
      ) : null}
    </>
  )
}
