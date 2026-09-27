'use server'

import { z } from 'zod'
import { getOwnProfile } from '@/features/profiles/queries'
import { getFeedPage, getPostingOrganizations } from './queries'
import type { ComposerProfile, FeedPage, PostingOrganization } from './types'

export type PostingOrganizationsResult =
  | { ok: true; organizations: PostingOrganization[] }
  | { ok: false; error: string }

export type OrganizationPostsTabResult =
  | {
    ok: true
    page: FeedPage
    /** Present only when the viewer may post as this organization. */
    composer: { profile: ComposerProfile; organization: PostingOrganization; organizations: PostingOrganization[] } | null
  }
  | { ok: false; error: string }

const organizationPostsRequestSchema = z.object({
  companyId: z.string().uuid(),
  limit: z.number().int().min(1).max(20).default(10),
  includeComposer: z.boolean().default(true),
})

/** Organizations the signed-in member may choose under "Post as". */
export async function loadPostingOrganizations(): Promise<PostingOrganizationsResult> {
  try {
    return { ok: true, organizations: await getPostingOrganizations() }
  } catch {
    return { ok: false, error: 'We could not load the organizations you post for. You can still post as yourself.' }
  }
}

/**
 * First page of an organization's posts, plus what the composer needs when the viewer can post
 * as the organization. The permission is decided here on the server, not by the page.
 */
export async function loadOrganizationPostsTab(input: { companyId: string; limit?: number; includeComposer?: boolean }): Promise<OrganizationPostsTabResult> {
  const parsed = organizationPostsRequestSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'This organization could not be found.' }
  try {
    const [page, organizations, profile] = await Promise.all([
      getFeedPage({ companyId: parsed.data.companyId, limit: parsed.data.limit }),
      parsed.data.includeComposer ? getPostingOrganizations() : Promise.resolve([]),
      parsed.data.includeComposer ? getOwnProfile() : Promise.resolve(null),
    ])
    const organization = organizations.find((entry) => entry.id === parsed.data.companyId)
    return {
      ok: true,
      page,
      composer: organization && profile
        ? {
          profile: {
            id: profile.id,
            fullName: profile.fullName,
            avatarUrl: profile.avatarUrl ?? null,
            rank: profile.rank,
            headline: profile.headline,
          },
          organization,
          organizations,
        }
        : null,
    }
  } catch {
    return { ok: false, error: 'We could not load this organization’s posts.' }
  }
}
