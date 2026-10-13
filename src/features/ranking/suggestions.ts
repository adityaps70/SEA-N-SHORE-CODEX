import { requireAwsUser } from '@/features/auth/aws-queries'
import { jobsRepository } from '@/features/jobs/repository'
import { candidatePersona } from '@/features/jobs/matching'
import { organizationWorkspaceRepository, type OrganizationWorkspace } from '@/features/organizations/workspace-repository'
import { communityRepository } from '@/features/community/repository'
import { suggestedGroupSlugs, SUGGESTION_FALLBACK_SLUG } from '@/features/community/suggestions'
import { rankDepartmentGroup } from '@/features/taxonomy/maritime-taxonomy'
import { jobPoolOptions } from './job-pool'
import { EVENT_CATEGORY_DEPARTMENTS, SUGGESTION_WEIGHTS } from './suggestion-weights'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { isRankingEnabled } from './switches'

/**
 * Round G (G5): personalised organization suggestions, behind ranking_settings.suggestions.
 * Returns null when the switch is off for this member, so pages keep their v1 lists.
 */
export async function getDiscoverOrganizationsForYou(limit = 6) {
  const user = await requireAwsUser()
  if (!await isRankingEnabled('suggestions', user.id)) return null
  const profile = await jobsRepository.getCandidateProfile(user.id).catch(() => null)
  const pool = jobPoolOptions(user.id, profile)
  return organizationWorkspaceRepository.listDiscoverOrganizationsForYou(user.id, {
    limit,
    departmentKeys: pool.departmentKeys,
    rankBandKeys: pool.rankBandKeys,
    cadet: profile ? candidatePersona(profile) === 'student_cadet' : false,
    weights: SUGGESTION_WEIGHTS.orgs,
  })
}

/** Round G (G5): the events "For you" tab (null when the suggestions switch is off for this member). */
export async function getEventsForYou(limit = 24) {
  const user = await requireAwsUser()
  if (!await isRankingEnabled('suggestions', user.id)) return null
  const profile = await jobsRepository.getCandidateProfile(user.id).catch(() => null)
  const department = rankDepartmentGroup(profile?.roleKey ?? profile?.targetRoleKey ?? null)
  const categories = Object.entries(EVENT_CATEGORY_DEPARTMENTS).filter(([, departments]) => department && departments.includes(department)).map(([category]) => category)
  const parts = (profile?.location ?? '').split(',').map((part) => part.trim()).filter(Boolean)
  return calendarEventRepository.listEventsForYou(user.id, {
    categories,
    city: parts[0] ?? null,
    country: parts.length > 1 ? parts[parts.length - 1]! : null,
    limit,
    weights: SUGGESTION_WEIGHTS.events,
  })
}

/** Community slugs that fit a persona or rank department (Family Anchor is matched when it exists). */
const PERSONA_COMMUNITY_SLUGS: Record<string, readonly string[]> = {
  seafarer_family: ['family-anchor'],
  student_cadet: ['cadets-community'],
}
const DEPARTMENT_COMMUNITY_SLUGS: Record<string, readonly string[]> = {
  deck: ['masters-senior-officers'],
  engine: ['marine-engineers'],
  electrical: ['marine-engineers'],
}

/** Round G (G5): communities for this member, or null when the suggestions switch is off for them. */
export async function getSuggestedCommunities(limit = 6) {
  const user = await requireAwsUser()
  if (!await isRankingEnabled('suggestions', user.id)) return null
  const [profile, signals] = await Promise.all([
    jobsRepository.getCandidateProfile(user.id).catch(() => null),
    communityRepository.getSuggestionSignals(user.id).catch(() => ({ rank: null, vesselTypes: [], persona: null })),
  ])
  const persona = profile ? candidatePersona(profile) : null
  const department = rankDepartmentGroup(profile?.roleKey ?? profile?.targetRoleKey ?? null)
  const slugs = [
    ...(persona ? PERSONA_COMMUNITY_SLUGS[persona] ?? [] : []),
    ...(department ? DEPARTMENT_COMMUNITY_SLUGS[department] ?? [] : []),
    ...suggestedGroupSlugs(signals).filter((slug) => slug !== SUGGESTION_FALLBACK_SLUG),
  ]
  return communityRepository.listSuggestedGroups(user.id, { profileSlugs: [...new Set(slugs)], limit, weights: SUGGESTION_WEIGHTS.communities })
}

/**
 * Round G (G5): replaces "Pages people also viewed" on an organization page: "People who follow
 * this page also follow" (co-follows, at least 3 shared followers), else "Similar pages".
 */
export async function getRelatedOrganizations(workspace: Pick<OrganizationWorkspace, 'id' | 'organizationType' | 'companyType'>, limit = 4) {
  const user = await requireAwsUser()
  if (!await isRankingEnabled('suggestions', user.id)) return null
  const coFollowed = await organizationWorkspaceRepository.listCoFollowedOrganizations(workspace.id, user.id, { limit, minShared: SUGGESTION_WEIGHTS.orgs.coFollowMinShared })
  if (coFollowed.length) return { title: 'People who follow this page also follow', organizations: coFollowed }
  return { title: 'Similar pages', organizations: await organizationWorkspaceRepository.listSimilarPagesByType(workspace, user.id, limit) }
}
