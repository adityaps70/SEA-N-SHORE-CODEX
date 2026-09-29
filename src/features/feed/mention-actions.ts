'use server'

import { organizationMentionSearchRepository } from '@/features/organizations/mention-search-repository'
import { getAwsNetworkProfiles } from '@/features/profiles/aws-queries'

export type MemberMentionCandidate = {
  kind: 'member'
  id: string
  slug: string
  fullName: string
  avatarUrl: string | null
  headline: string | null
  rank: string | null
  currentCompany: string | null
}

/** A verified or claimed organization page (round 9B); `id` is the company id. */
export type OrganizationMentionCandidate = {
  kind: 'organization'
  id: string
  slug: string
  name: string
  logoUrl: string | null
  /** Organization type and location, e.g. "Ship manager · Chennai". */
  subtitle: string | null
}

export type MentionCandidate = MemberMentionCandidate | OrganizationMentionCandidate

const MEMBER_LIMIT = 8
const ORGANIZATION_LIMIT = 5

async function memberCandidates(query: string): Promise<MemberMentionCandidate[]> {
  try {
    const profiles = await getAwsNetworkProfiles(MEMBER_LIMIT, query)
    return profiles.slice(0, MEMBER_LIMIT).map((profile) => ({
      kind: 'member' as const,
      id: profile.id,
      slug: profile.slug,
      fullName: profile.fullName,
      avatarUrl: profile.avatarUrl ?? null,
      headline: profile.headline,
      rank: profile.rank,
      currentCompany: profile.currentCompany,
    }))
  } catch {
    return []
  }
}

async function organizationCandidates(query: string): Promise<OrganizationMentionCandidate[]> {
  if (!query) return []
  try {
    const organizations = await organizationMentionSearchRepository.searchMentionableOrganizations(query, ORGANIZATION_LIMIT)
    return organizations.map((organization) => ({
      kind: 'organization' as const,
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      logoUrl: organization.logoUrl,
      subtitle: organization.subtitle,
    }))
  } catch {
    return []
  }
}

/** Members first, then organizations whose name matches; either list failing leaves the other. */
export async function searchMentionCandidates(query: string): Promise<MentionCandidate[]> {
  const normalized = query.trim().slice(0, 80)
  const [members, organizations] = await Promise.all([memberCandidates(normalized), organizationCandidates(normalized)])
  return [...members, ...organizations]
}
