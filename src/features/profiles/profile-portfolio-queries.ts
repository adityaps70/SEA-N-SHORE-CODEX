import { requireAwsUser } from '@/features/auth/aws-queries'
import { getProfilePortfolio } from './profile-portfolio-repository'
import type { ProfilePortfolio } from './profile-portfolio-types'

export async function getOwnProfilePortfolio(): Promise<ProfilePortfolio> {
  const user = await requireAwsUser()
  return getProfilePortfolio(user.id)
}

export async function getProfilePortfolioById(profileId: string): Promise<ProfilePortfolio> {
  return getProfilePortfolio(profileId)
}
