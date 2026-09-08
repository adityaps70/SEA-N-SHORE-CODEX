import type { PublicProfile } from './types'

export type ProfileReadiness = {
  score: number
  completed: number
  total: number
  nextSteps: string[]
}

type ReadinessCheck = {
  complete: boolean
  guidance: string
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim())
}

export function getProfileReadiness(profile: PublicProfile): ProfileReadiness {
  const maritime = profile.profileType === 'seafarer' || profile.profileType === 'maritime_professional'
  const checks: ReadinessCheck[] = [
    {
      complete: hasText(profile.avatarPath),
      guidance: 'Add a professional photo',
    },
    {
      complete: hasText(profile.coverPath),
      guidance: 'Add a cover image that represents your maritime career',
    },
    {
      complete: hasText(profile.headline) && hasText(profile.location),
      guidance: 'Complete your headline and location',
    },
    {
      complete: hasText(profile.summary),
      guidance: 'Write your professional summary',
    },
    {
      complete: profile.skills.length > 0,
      guidance: 'Add professional skills',
    },
  ]

  if (maritime) {
    checks.push(
      {
        complete: hasText(profile.rank) && profile.sailingExperienceYears != null,
        guidance: 'Add your rank and sea-service experience',
      },
      {
        complete: profile.vesselTypes.length > 0 && profile.tradingAreas.length > 0,
        guidance: 'Add vessel types and trading areas',
      },
      {
        complete: hasText(profile.currentCompany) && hasText(profile.currentVessel),
        guidance: 'Add your current company and vessel',
      },
      {
        complete: hasText(profile.availability),
        guidance: 'Set your current availability',
      },
    )
  }

  const completed = checks.filter((check) => check.complete).length
  const total = checks.length

  return {
    score: total === 0 ? 100 : Math.round((completed / total) * 100),
    completed,
    total,
    nextSteps: checks.filter((check) => !check.complete).map((check) => check.guidance).slice(0, 4),
  }
}
