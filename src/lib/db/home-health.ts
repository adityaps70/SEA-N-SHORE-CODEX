import type { QueryResultRow } from 'pg'
import { mapFeedPost, type FeedCommentRow, type FeedPostRow } from '@/features/feed/mappers'
import { resolveFeedMediaUrls } from '@/features/feed/media'
import { feedRepository } from '@/features/feed/repository'
import { networkRepository } from '@/features/network/repository'
import { scoreRecommendation } from '@/features/network/recommendations'
import {
  getDiscoveryCandidatesFromAurora,
  getOwnProfileFromAurora,
} from '@/features/profiles/repository'
import { query as databaseQuery } from './client'

type ProfileIdRow = QueryResultRow & { profile_id: string }

export type HomeRuntimeHealth = {
  profile: boolean
  network: boolean
  discovery: boolean
  feed: boolean
  hydration: boolean
  media: boolean
}

const EMPTY_HEALTH: HomeRuntimeHealth = {
  profile: false,
  network: false,
  discovery: false,
  feed: false,
  hydration: false,
  media: false,
}

function mediaPath(row: FeedPostRow) {
  const media = Array.isArray(row.post_media) ? row.post_media[0] ?? null : row.post_media
  return media?.storage_path ?? null
}

function groupComments(comments: FeedCommentRow[]) {
  const grouped = new Map<string, FeedCommentRow[]>()
  for (const comment of comments) {
    if (!comment.post_id) continue
    const existing = grouped.get(comment.post_id) ?? []
    existing.push(comment)
    grouped.set(comment.post_id, existing)
  }
  return grouped
}

export async function checkHomeRuntimeHealth(): Promise<HomeRuntimeHealth> {
  let profiles: ProfileIdRow[]
  try {
    profiles = await databaseQuery<ProfileIdRow>(
      `select ia.profile_id
       from public.identity_accounts ia
       join public.profiles p on p.id = ia.profile_id
       where ia.provider = $1
         and p.account_status = 'active'
         and p.onboarding_completed_at is not null
       order by ia.profile_id asc`,
      ['cognito'],
    )
  } catch {
    return { ...EMPTY_HEALTH }
  }

  if (profiles.length === 0) return { ...EMPTY_HEALTH }

  const ownProfiles = new Map<string, NonNullable<Awaited<ReturnType<typeof getOwnProfileFromAurora>>>>()
  try {
    for (const row of profiles) {
      const profile = await getOwnProfileFromAurora(row.profile_id)
      if (!profile) return { ...EMPTY_HEALTH }
      ownProfiles.set(row.profile_id, profile)
    }
  } catch {
    return { ...EMPTY_HEALTH }
  }

  const afterProfile: HomeRuntimeHealth = { ...EMPTY_HEALTH, profile: true }
  const graphs = new Map<string, Awaited<ReturnType<typeof networkRepository.loadViewerGraph>>>()
  try {
    for (const row of profiles) {
      graphs.set(row.profile_id, await networkRepository.loadViewerGraph(row.profile_id))
    }
  } catch {
    return afterProfile
  }

  const afterNetwork: HomeRuntimeHealth = { ...afterProfile, network: true }
  try {
    for (const row of profiles) {
      const viewer = ownProfiles.get(row.profile_id)
      if (!viewer) return afterNetwork
      const candidates = await getDiscoveryCandidatesFromAurora({
        viewerProfileId: row.profile_id,
        limit: 60,
      })
      for (const candidate of candidates) scoreRecommendation(viewer, candidate)
    }
  } catch {
    return afterNetwork
  }

  const afterDiscovery: HomeRuntimeHealth = { ...afterNetwork, discovery: true }
  const feedRows = new Map<string, FeedPostRow[]>()
  try {
    for (const row of profiles) {
      feedRows.set(row.profile_id, await feedRepository.listFeedRows({
        viewerProfileId: row.profile_id,
        limit: 21,
      }))
    }
  } catch {
    return afterDiscovery
  }

  const afterFeed: HomeRuntimeHealth = { ...afterDiscovery, feed: true }
  try {
    for (const row of profiles) {
      const rows = feedRows.get(row.profile_id) ?? []
      const pageRows = rows.slice(0, 20)
      const postIds = pageRows.map((post) => post.id)
      const [viewerState, comments] = await Promise.all([
        feedRepository.getViewerState(row.profile_id, postIds),
        feedRepository.getComments(postIds),
      ])
      const commentsByPost = groupComments(comments)
      for (const post of pageRows) {
        mapFeedPost(
          { ...post, post_comments: commentsByPost.get(post.id) ?? [] },
          viewerState,
        )
      }
    }
  } catch {
    return afterFeed
  }

  const afterHydration: HomeRuntimeHealth = { ...afterFeed, hydration: true }
  try {
    const paths = [...new Set(
      [...feedRows.values()]
        .flatMap((rows) => rows.slice(0, 20))
        .map(mediaPath)
        .filter((path): path is string => Boolean(path)),
    )]
    await resolveFeedMediaUrls(paths)
  } catch {
    return afterHydration
  }

  void graphs
  return { ...afterHydration, media: true }
}
