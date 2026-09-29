import type {
  FeedAuthor,
  FeedComment,
  FeedCommentReplyTarget,
  FeedGroupRef,
  FeedMention,
  FeedOrganization,
  FeedOrganizationMention,
  FeedPhotoTag,
  FeedPost,
  FeedPostType,
  FeedRepostSource,
  HiddenPost,
  PostCategory,
  PostReactionType,
  ReactionSummary,
} from './types'
import { EMPTY_REACTION_SUMMARY, POST_REACTIONS, reactionCount } from './types'

type MaritimeSummaryRow = {
  rank: string | null
  current_company: string | null
}

type AuthorRow = {
  id: string
  slug: string | null
  full_name: string
  avatar_path: string | null
  headline: string | null
  maritime_profiles: MaritimeSummaryRow | MaritimeSummaryRow[] | null
}

type MentionRow = {
  profile_id: string
  slug: string | null
  full_name: string
}

type ReplyTargetRow = {
  comment_id: string
  author_name: string | null
  author_slug: string | null
}

export type OrganizationIdentityRow = {
  id: string
  slug: string
  name: string
  logo_path: string | null
}

type ReactionCountsRow = Partial<Record<PostReactionType, number>> & { count?: number }

export type FeedCommentRow = {
  id: string
  post_id?: string
  parent_comment_id?: string | null
  reply_to?: ReplyTargetRow | null
  body: string
  created_at: string
  updated_at?: string
  deleted_at?: string | null
  viewer_owns?: boolean
  can_edit?: boolean
  profiles: AuthorRow | AuthorRow[] | null
  reaction_summary?: ReactionCountsRow | null
  viewer_reaction?: PostReactionType | null
  mentions?: MentionRow[] | null
  organization_mentions?: OrganizationMentionRow[] | null
}

type MediaRow = {
  id?: string | null
  storage_path: string
  mime_type: string
  alt_text: string | null
  position?: number | null
  file_name?: string | null
  page_count?: number | null
}

type PollOptionRow = {
  id: string
  label: string
  position: number
  post_poll_votes?: Array<{ count: number }> | { count: number } | null
}

type PollRow = {
  post_poll_options: PollOptionRow[]
}

type GroupRefRow = {
  id: string
  slug: string
  name: string
  visibility: 'public' | 'private'
}

export type OrganizationMentionRow = {
  company_id: string
  slug: string
  name: string
  logo_path?: string | null
}

type PhotoTagRow = {
  media_id: string
  profile_id: string
  slug: string
  full_name: string
  avatar_path?: string | null
}

export type FeedPostRow = {
  id: string
  category: PostCategory
  body: string
  post_type: FeedPostType
  repost_of_post_id?: string | null
  repost_source?: FeedPostRow | FeedPostRow[] | null
  /** Organization the post was published as (migration 0044). */
  company_id?: string | null
  organization?: OrganizationIdentityRow | OrganizationIdentityRow[] | null
  /** Community group the post was published in (migration 0055). */
  group_id?: string | null
  post_group?: GroupRefRow | GroupRefRow[] | null
  post_organization_mentions?: OrganizationMentionRow[] | null
  post_hashtags?: string[] | null
  post_photo_tags?: PhotoTagRow[] | null
  viewer_follows_organization?: boolean | null
  created_at: string
  updated_at: string
  profiles: AuthorRow | AuthorRow[] | null
  post_media: MediaRow | MediaRow[] | null
  post_polls: PollRow | PollRow[] | null
  post_reactions?: ReactionCountsRow | Array<{ count: number }> | { count: number } | null
  post_comment_count?: Array<{ count: number }> | { count: number } | null
  post_mentions?: MentionRow[] | null
  post_comments?: FeedCommentRow[] | null
  viewer_follows_author?: boolean | null
}

export type FeedViewerState = {
  postReactions?: Map<string, PostReactionType>
  likedPostIds?: Set<string>
  savedPostIds: Set<string>
  pollVotes: Map<string, string>
}

function firstOrNull<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function countRelation(value: Array<{ count: number }> | { count: number } | null | undefined) {
  if (Array.isArray(value)) return value[0]?.count ?? 0
  return value?.count ?? 0
}

function mapReactionSummary(value: FeedPostRow['post_reactions'] | FeedCommentRow['reaction_summary']): ReactionSummary {
  if (!value || Array.isArray(value)) {
    const legacy = countRelation(value as Array<{ count: number }> | { count: number } | null | undefined)
    return { ...EMPTY_REACTION_SUMMARY, like: legacy }
  }
  const row = value as ReactionCountsRow
  if (!POST_REACTIONS.some((reaction) => row[reaction] !== undefined)) {
    return { ...EMPTY_REACTION_SUMMARY, like: Number(row.count ?? 0) }
  }
  return {
    like: Number(row.like ?? 0),
    support: Number(row.support ?? 0),
    respect: Number(row.respect ?? 0),
    on_point: Number(row.on_point ?? 0),
  }
}

export function mapOrganizationMentions(rows: OrganizationMentionRow[] | null | undefined): FeedOrganizationMention[] {
  return (rows ?? []).flatMap((row) => row.company_id && row.slug ? [{
    companyId: row.company_id,
    slug: row.slug,
    name: row.name,
    logoUrl: organizationLogoUrl(row.company_id, row.logo_path),
  }] : [])
}

function mapHashtags(value: string[] | null | undefined): string[] {
  return (value ?? []).filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
}

function mapPhotoTags(rows: PhotoTagRow[] | null | undefined, signedUrls: Map<string, string>): FeedPhotoTag[] {
  return (rows ?? []).flatMap((row) => row.media_id && row.slug ? [{
    mediaId: row.media_id,
    profileId: row.profile_id,
    slug: row.slug,
    fullName: row.full_name,
    avatarUrl: row.avatar_path ? signedUrls.get(row.avatar_path) ?? null : null,
  }] : [])
}

function mapGroup(row: GroupRefRow | GroupRefRow[] | null | undefined): FeedGroupRef | null {
  const group = firstOrNull(row)
  if (!group?.id || !group.slug) return null
  return { id: group.id, slug: group.slug, name: group.name, visibility: group.visibility === 'private' ? 'private' : 'public' }
}

function mapMentions(rows: MentionRow[] | null | undefined): FeedMention[] {
  return (rows ?? []).flatMap((row) => row.slug ? [{
    profileId: row.profile_id,
    slug: row.slug,
    fullName: row.full_name,
  }] : [])
}

export function feedAuthorAvatarPath(row: AuthorRow | AuthorRow[] | null | undefined) {
  return firstOrNull(row)?.avatar_path ?? null
}

function mediaRows(value: FeedPostRow['post_media']): MediaRow[] {
  if (!value) return []
  return (Array.isArray(value) ? value : [value])
    .filter((item): item is MediaRow => Boolean(item?.storage_path))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
}

export function feedPostMediaPaths(row: FeedPostRow) {
  return mediaRows(row.post_media).map((media) => media.storage_path)
}

/** Avatar paths of members tagged in the post's photos, for signing alongside the media. */
export function feedPhotoTagAvatarPaths(row: FeedPostRow) {
  return (row.post_photo_tags ?? []).flatMap((tag) => tag.avatar_path ? [tag.avatar_path] : [])
}

export function feedPostMediaPath(row: FeedPostRow) {
  return feedPostMediaPaths(row)[0] ?? null
}

function mapAuthor(row: AuthorRow | AuthorRow[] | null, signedUrls: Map<string, string>): FeedAuthor {
  const author = firstOrNull(row)
  if (!author || !author.slug) throw new Error('Feed author is missing a completed professional identity.')
  const maritime = firstOrNull(author.maritime_profiles)
  return {
    id: author.id,
    slug: author.slug,
    fullName: author.full_name,
    avatarPath: author.avatar_path,
    avatarUrl: author.avatar_path ? signedUrls.get(author.avatar_path) ?? null : null,
    headline: author.headline,
    rank: maritime?.rank ?? null,
    currentCompany: maritime?.current_company ?? null,
  }
}

/** Organization logos are served by the first-party, signed-in-only logo route. */
export function organizationLogoUrl(companyId: string, logoPath: string | null | undefined) {
  return logoPath?.trim() ? `/api/company-logo/${companyId}` : null
}

export function mapOrganization(row: OrganizationIdentityRow | OrganizationIdentityRow[] | null | undefined): FeedOrganization | null {
  const organization = firstOrNull(row)
  if (!organization?.id || !organization.slug || !organization.name) return null
  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    logoUrl: organizationLogoUrl(organization.id, organization.logo_path),
  }
}

function mapReplyTarget(row: ReplyTargetRow | null | undefined): FeedCommentReplyTarget | null {
  if (!row?.comment_id || !row.author_name) return null
  return { commentId: row.comment_id, authorName: row.author_name, authorSlug: row.author_slug ?? null }
}

function mapComment(row: FeedCommentRow, signedUrls: Map<string, string>): FeedComment {
  const reactionSummary = mapReactionSummary(row.reaction_summary)
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    viewerOwns: Boolean(row.viewer_owns),
    canEdit: Boolean(row.can_edit),
    deleted: Boolean(row.deleted_at),
    author: mapAuthor(row.profiles, signedUrls),
    parentCommentId: row.parent_comment_id ?? null,
    replyTo: mapReplyTarget(row.reply_to),
    reactionSummary,
    reactionCount: reactionCount(reactionSummary),
    viewerReaction: row.viewer_reaction ?? null,
    mentions: mapMentions(row.mentions),
    organizationMentions: mapOrganizationMentions(row.organization_mentions),
  }
}

function mapMediaItems(row: FeedPostRow, signedUrls: Map<string, string>) {
  return mediaRows(row.post_media).map((media, index) => ({
    id: media.id ?? null,
    storagePath: media.storage_path,
    mimeType: media.mime_type,
    altText: media.alt_text,
    signedUrl: signedUrls.get(media.storage_path) ?? null,
    position: Number(media.position ?? index),
    fileName: media.file_name ?? null,
    pageCount: media.page_count == null ? null : Number(media.page_count),
  }))
}

function mapMedia(row: FeedPostRow, signedUrls: Map<string, string>) {
  return mapMediaItems(row, signedUrls)[0] ?? null
}

function mapPoll(row: FeedPostRow, viewer: FeedViewerState) {
  if (row.post_type !== 'poll') return null
  const poll = firstOrNull(row.post_polls)
  const options = [...(poll?.post_poll_options ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((option) => ({
      id: option.id,
      label: option.label,
      position: option.position,
      voteCount: countRelation(option.post_poll_votes),
    }))
  return {
    options,
    totalVotes: options.reduce((total, option) => total + option.voteCount, 0),
    viewerOptionId: viewer.pollVotes.get(row.id) ?? null,
  }
}

function mapRepostSource(row: FeedPostRow | null, viewer: FeedViewerState, signedUrls: Map<string, string>): FeedRepostSource | null {
  if (!row || row.post_type === 'repost') return null
  return {
    id: row.id,
    category: row.category,
    body: row.body,
    postType: row.post_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: mapAuthor(row.profiles, signedUrls),
    media: mapMedia(row, signedUrls),
    mediaItems: mapMediaItems(row, signedUrls),
    poll: mapPoll(row, viewer),
    mentions: mapMentions(row.post_mentions),
    organizationMentions: mapOrganizationMentions(row.post_organization_mentions),
    hashtags: mapHashtags(row.post_hashtags),
    photoTags: mapPhotoTags(row.post_photo_tags, signedUrls),
    organization: mapOrganization(row.organization),
    group: mapGroup(row.post_group),
  }
}

export function mapFeedPost(
  row: FeedPostRow,
  viewer: FeedViewerState,
  signedUrls: Map<string, string> = new Map(),
  viewerProfileId = '',
): FeedPost {
  const author = mapAuthor(row.profiles, signedUrls)
  const comments = (row.post_comments ?? []).map((comment) => mapComment(comment, signedUrls))
  const reactionSummary = mapReactionSummary(row.post_reactions)
  const viewerReaction = viewer.postReactions?.get(row.id)
    ?? (viewer.likedPostIds?.has(row.id) ? 'like' : null)
  const repostSource = row.post_type === 'repost' ? firstOrNull(row.repost_source) : null
  const viewerOwns = Boolean(viewerProfileId) && author.id === viewerProfileId

  return {
    id: row.id,
    category: row.category,
    body: row.body,
    postType: row.post_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author,
    media: mapMedia(row, signedUrls),
    mediaItems: mapMediaItems(row, signedUrls),
    poll: mapPoll(row, viewer),
    repostOf: mapRepostSource(repostSource, viewer, signedUrls),
    reactionSummary,
    reactionCount: reactionCount(reactionSummary),
    viewerReaction,
    likeCount: reactionSummary.like,
    viewerLiked: viewerReaction === 'like',
    commentCount: countRelation(row.post_comment_count) || comments.length,
    viewerSaved: viewer.savedPostIds.has(row.id),
    viewerOwns,
    organization: mapOrganization(row.organization),
    // Organization admins get edit/delete through the queries layer, which knows their roles.
    viewerCanEdit: viewerOwns,
    viewerCanDelete: viewerOwns,
    viewerFollowsAuthor: Boolean(viewerProfileId) && author.id !== viewerProfileId && Boolean(row.viewer_follows_author),
    mentions: mapMentions(row.post_mentions),
    organizationMentions: mapOrganizationMentions(row.post_organization_mentions),
    hashtags: mapHashtags(row.post_hashtags),
    photoTags: mapPhotoTags(row.post_photo_tags, signedUrls),
    group: mapGroup(row.post_group),
    comments,
  }
}

/** Only photos and videos make a thumbnail; documents fall back to the text preview. */
export function isThumbnailMime(mimeType: string | null | undefined) {
  return Boolean(mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/')))
}

export type HiddenPostSourceRow = {
  id: string
  body: string
  post_type: FeedPostType
  created_at: string
  hidden_at: string
  author_id: string
  author_slug: string | null
  author_name: string
  author_avatar_path: string | null
  company_id: string | null
  company_slug: string | null
  company_name: string | null
  company_logo_path: string | null
  source_body: string | null
  media_path: string | null
  media_mime_type: string | null
}

/** Storage paths a hidden-post preview needs signed: the author's photo and the first media item. */
export function hiddenPostPaths(row: HiddenPostSourceRow) {
  return [row.author_avatar_path, isThumbnailMime(row.media_mime_type) ? row.media_path : null]
    .filter((path): path is string => Boolean(path))
}

export function mapHiddenPost(row: HiddenPostSourceRow, signedUrls: Map<string, string>): HiddenPost | null {
  if (!row.author_slug) return null
  const isRepost = row.post_type === 'repost'
  const thumbnailUrl = row.media_path && isThumbnailMime(row.media_mime_type) ? signedUrls.get(row.media_path) ?? null : null
  return {
    id: row.id,
    body: isRepost && !row.body.trim() ? row.source_body ?? '' : row.body,
    isRepost,
    createdAt: row.created_at,
    hiddenAt: row.hidden_at,
    author: {
      id: row.author_id,
      slug: row.author_slug,
      fullName: row.author_name,
      avatarUrl: row.author_avatar_path ? signedUrls.get(row.author_avatar_path) ?? null : null,
    },
    organization: mapOrganization(row.company_id && row.company_slug && row.company_name
      ? { id: row.company_id, slug: row.company_slug, name: row.company_name, logo_path: row.company_logo_path }
      : null),
    thumbnail: thumbnailUrl && row.media_mime_type ? { url: thumbnailUrl, mimeType: row.media_mime_type } : null,
  }
}
