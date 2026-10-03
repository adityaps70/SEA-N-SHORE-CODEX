import { roleDisplayLabel } from '@/features/roles/taxonomy'
import { mapLinkedOrganization } from './organization-link'
import type { PublicProfile, PublicProfileRow } from './types'

export function mapPublicProfile(row: PublicProfileRow): PublicProfile {
  const maritime = row.maritime_profiles

  return {
    id: row.id,
    slug: row.slug,
    profileType: row.profile_type,
    identityRoot: row.identity_root ?? null,
    primaryIdentity: row.primary_identity ?? null,
    primaryIdentityFamily: row.primary_identity_family ?? null,
    secondaryIdentities: row.secondary_identities ?? [],
    persona: row.persona ?? null,
    profileIntents: row.profile_intents ?? [],
    communityRelationship: row.community_relationship ?? null,
    institutionName: row.institution_name ?? null,
    specialization: row.specialization ?? null,
    roleDepartmentKey: row.role_department_key ?? null,
    roleKey: row.role_key ?? null,
    roleOtherText: row.role_other_text ?? null,
    cadetStageKey: row.cadet_stage_key ?? null,
    cadetCourseKey: row.cadet_course_key ?? null,
    targetDepartmentKey: row.target_department_key ?? null,
    targetRoleKey: row.target_role_key ?? null,
    occupationText: row.occupation_text ?? null,
    fullName: row.full_name,
    avatarPath: row.avatar_path,
    avatarUrl: null,
    coverPath: row.cover_path ?? null,
    coverUrl: null,
    location: row.location,
    headline: row.headline,
    summary: row.summary,
    // Round 12: the taxonomy label (or the typed "Other" text), falling back to the old rank text.
    rank: roleDisplayLabel({ roleKey: row.role_key, otherText: row.role_other_text, legacyText: maritime?.rank }),
    currentCompany: maritime?.current_company ?? null,
    currentCompanyId: maritime?.current_company_id ?? null,
    currentOrganization: mapLinkedOrganization(row.current_organization),
    currentVessel: maritime?.current_vessel ?? null,
    sailingExperienceYears: maritime?.sailing_experience_years ?? null,
    vesselTypes: maritime?.vessel_types ?? [],
    tradingAreas: maritime?.trading_areas ?? [],
    shoreCareerPreference: maritime?.shore_career_preference ?? false,
    availability: maritime?.availability ?? null,
    skills: row.profile_skills.map(({ skill }) => skill),
  }
}
