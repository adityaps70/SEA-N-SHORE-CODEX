import type { OwnProfile } from '@/features/profiles/types'

export type ProfilePortfolioCompletion = {
  experienceCount: number
  credentialCount: number
}

export function calculateProfileCompletion(
  profile: OwnProfile,
  portfolio: ProfilePortfolioCompletion = { experienceCount: 0, credentialCount: 0 },
): number {
  const generic = [
    Boolean(profile.fullName.trim()),
    Boolean(profile.headline?.trim()),
    Boolean(profile.summary?.trim()),
    Boolean(profile.location?.trim()),
    profile.skills.length > 0,
  ]

  const checks = profile.profileType === 'seafarer' || profile.profileType === 'maritime_professional'
    ? [
        ...generic,
        Boolean(profile.rank?.trim()),
        Boolean(profile.currentCompany?.trim()),
        profile.sailingExperienceYears !== null,
        portfolio.experienceCount > 0,
        portfolio.credentialCount > 0,
      ]
    : generic

  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}
