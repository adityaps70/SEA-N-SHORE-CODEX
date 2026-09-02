import type { PublicProfile, PublicProfileRow } from './types'

export function mapPublicProfile(row: PublicProfileRow): PublicProfile {
  const maritime = row.maritime_profiles

  return {
    id: row.id,
    slug: row.slug,
    profileType: row.profile_type,
    fullName: row.full_name,
    avatarPath: row.avatar_path,
    location: row.location,
    headline: row.headline,
    summary: row.summary,
    rank: maritime?.rank ?? null,
    currentCompany: maritime?.current_company ?? null,
    currentVessel: maritime?.current_vessel ?? null,
    sailingExperienceYears: maritime?.sailing_experience_years ?? null,
    vesselTypes: maritime?.vessel_types ?? [],
    tradingAreas: maritime?.trading_areas ?? [],
    shoreCareerPreference: maritime?.shore_career_preference ?? false,
    availability: maritime?.availability ?? null,
    skills: row.profile_skills.map(({ skill }) => skill),
  }
}
