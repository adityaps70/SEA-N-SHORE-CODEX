'use server'

import { getAwsNetworkProfiles } from '@/features/profiles/aws-queries'

export type MentionCandidate = {
  id: string
  slug: string
  fullName: string
  avatarUrl: string | null
  headline: string | null
  rank: string | null
  currentCompany: string | null
}

export async function searchMentionCandidates(query: string): Promise<MentionCandidate[]> {
  const normalized = query.trim().slice(0, 80)
  try {
    const profiles = await getAwsNetworkProfiles(8, normalized)
    return profiles.slice(0, 8).map((profile) => ({
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
