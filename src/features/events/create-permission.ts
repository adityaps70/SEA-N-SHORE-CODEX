import { getAccessContext } from '@/features/access/server'
import { organizationRepository } from '@/features/organizations/repository'
import { getOwnProfileFromAurora } from '@/features/profiles/repository'
import { buildEventPublisherOptions } from './publishers'

/**
 * Round H (H7): may this member publish an event now, personally or for one of their organizations?
 * The same publisher rules the create-event page uses (verified event host or organization, with a plan
 * that includes events); the page itself stays open to everyone and explains what is missing.
 */
export async function canViewerCreateEvents(userId: string) {
  const [access, profile, organizations] = await Promise.all([
    getAccessContext(userId),
    getOwnProfileFromAurora(userId),
    organizationRepository.listUserOrganizations(userId),
  ])
  if (!profile) return false
  return buildEventPublisherOptions(access, { profileId: profile.id, name: profile.fullName }, organizations)
    .some((option) => option.canPublish)
}
