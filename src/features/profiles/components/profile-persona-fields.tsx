'use client'

import { PERSONAS, PERSONA_LABELS, type Persona } from '../persona'
import { ProfileRoleFields } from '@/features/roles/components/profile-role-fields'
import { personaDetailFields } from '../profile-persona-rules'
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
 * Department → Rank / Role (round 12), institute for Student / Cadet, relationship for Seafarer Family,
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
  // Organisation accounts never get a rank; every other profile type gets its role questions.
  const showRoleFields = fields.includes('rank') && profile.identityRoot !== 'organisation'

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
      {showRoleFields ? (
        // Round 12: Department → Rank / Role, cadet stage and target role, or occupation for this profile type.
        <ProfileRoleFields
          persona={persona}
          variant="card"
          initial={{
            roleDepartmentKey: profile.roleDepartmentKey,
            roleKey: profile.roleKey,
            roleOtherText: profile.roleOtherText,
            cadetStageKey: profile.cadetStageKey,
            cadetCourseKey: profile.cadetCourseKey,
            targetDepartmentKey: profile.targetDepartmentKey,
            targetRoleKey: profile.targetRoleKey,
            occupationText: profile.occupationText,
            legacyRank: profile.roleKey ? null : profile.rank,
          }}
          error={(name) => fieldErrors?.[name]?.[0]}
        />
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
