import { cache } from 'react'
import { getProfilePortfolio } from './profile-portfolio-repository'
import { organizationLinkRepository } from './organization-link-repository'

/**
 * Round P3: reads that the signed-in chrome (app-chrome-data.ts) and a page (Home's rails) both
 * make for the same member, run once per render. React's cache() only shares results within one
 * server render; Server Actions and route handlers outside a render always read fresh.
 */
export const getProfilePortfolioForRequest = cache((profileId: string) => getProfilePortfolio(profileId))

export const listMemberOrganizationsForRequest = cache((userId: string) => organizationLinkRepository.listMemberOrganizations(userId))
