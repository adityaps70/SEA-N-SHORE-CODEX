import { requireAwsUser } from '@/features/auth/aws-queries'
import { certificateRepository, type ProfileLearningCertificate } from '@/features/learning/certificate-repository'
import { getProfilePortfolio } from './profile-portfolio-repository'
import type { ProfilePortfolio } from './profile-portfolio-types'

/** Sea N Shore certificates for Licences & Credentials (learning round B, B5). A failure hides them, never the page. */
async function learningCertificates(profileId: string, includeHidden: boolean): Promise<ProfileLearningCertificate[]> {
  try {
    return await certificateRepository.listForProfile(profileId, { includeHidden })
  } catch (error) {
    console.error('[profile_learning_certificates_error]', { code: error instanceof Error ? error.name : 'unknown' })
    return []
  }
}

/** The signed-in member's portfolio; `withCertificates` adds every Sea N Shore certificate (hidden ones too). */
export async function getOwnProfilePortfolio(options: { withCertificates?: boolean } = {}): Promise<ProfilePortfolio> {
  const user = await requireAwsUser()
  if (!options.withCertificates) return getProfilePortfolio(user.id)
  const [portfolio, certificates] = await Promise.all([getProfilePortfolio(user.id), learningCertificates(user.id, true)])
  return { ...portfolio, learningCertificates: certificates }
}

/** A public profile's portfolio, with the Sea N Shore certificates its member shows. */
export async function getProfilePortfolioById(profileId: string): Promise<ProfilePortfolio> {
  const [portfolio, certificates] = await Promise.all([getProfilePortfolio(profileId), learningCertificates(profileId, false)])
  return { ...portfolio, learningCertificates: certificates }
}
