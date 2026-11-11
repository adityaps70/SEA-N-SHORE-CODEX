export const POST_CATEGORIES = [
  'maritime_news',
  'technical_discussion',
  'vetting_sire_2_0',
  'career_advice',
  'safety_lessons',
  'achievement',
  'learning',
  'industry_opinion',
] as const

export type PostCategory = (typeof POST_CATEGORIES)[number]

export const POST_CATEGORY_LABELS: Record<PostCategory, string> = {
  maritime_news: 'Maritime News',
  technical_discussion: 'Technical Discussion',
  vetting_sire_2_0: 'Vetting & SIRE 2.0',
  career_advice: 'Career Advice',
  safety_lessons: 'Safety Lessons',
  achievement: 'Achievement',
  learning: 'Learning',
  industry_opinion: 'Industry Opinion',
}

/**
 * Who can see a post (round F). 'anyone': the post opens from a shared link without an account, read-only.
 * 'members': signed-in members only. Community posts are always 'members'.
 */
export const POST_AUDIENCES = ['anyone', 'members'] as const
export type PostAudience = (typeof POST_AUDIENCES)[number]
export const POST_AUDIENCE_LABELS: Record<PostAudience, string> = {
  anyone: 'Anyone',
  members: 'Members only',
}
export const POST_AUDIENCE_HINTS: Record<PostAudience, string> = {
  anyone: 'Anyone with the link can read it, even without an account.',
  members: 'Only people signed in to Sea N Shore can see it.',
}

export const POST_REACTIONS = ['like', 'support', 'respect', 'on_point'] as const
export type PostReactionType = (typeof POST_REACTIONS)[number]
export type ReactionSummary = Record<PostReactionType, number>
export type ReactionTargetType = 'post' | 'comment'
export type FeedPostType = 'standard' | 'poll' | 'repost'

export const POST_REACTION_META: Record<PostReactionType, { label: string; emoji: string }> = {
  like: { label: 'Like', emoji: '👍' },
  support: { label: 'Support', emoji: '❤️' },
  respect: { label: 'Respect', emoji: '🫡' },
  on_point: { label: 'On Point', emoji: '⚓' },
}

export const EMPTY_REACTION_SUMMARY: ReactionSummary = {
  like: 0,
  support: 0,
  respect: 0,
  on_point: 0,
}

export function reactionCount(summary: ReactionSummary) {
  return POST_REACTIONS.reduce((total, reaction) => total + summary[reaction], 0)
}

export type FeedCursor = {
  createdAt: string
  id: string
}

export type FeedAuthor = {
  id: string
  slug: string
  fullName: string
  avatarPath: string | null
  avatarUrl?: string | null
  headline: string | null
  rank: string | null
  currentCompany: string | null
}

/** The organization a post was published as. The person stays the stored author. */
export type FeedOrganization = {
  id: string
  slug: string
  name: string
  /** First-party logo route, or null when the organization has no logo. */
  logoUrl: string | null
}

/** An organization the signed-in member may publish posts for ("Post as"). */
export type PostingOrganization = FeedOrganization

/** The member identity the post composer shows. */
export type ComposerProfile = {
  id: string
  fullName: string
  avatarUrl?: string | null
  rank: string | null
  headline: string | null
}

export type ReactorProfile = FeedAuthor & {
  reaction: PostReactionType
  reactedAt: string
}

export type ReactionDetailsPage = {
  reactors: ReactorProfile[]
  nextCursor: string | null
}

export type FeedMedia = {
  /** post_media row id; absent on optimistic/legacy shapes. */
  id?: string | null
  storagePath: string
  mimeType: string
  altText: string | null
  signedUrl: string | null
  position?: number
  fileName?: string | null
  pageCount?: number | null
}

export type FeedPollOption = {
  id: string
  label: string
  position: number
  voteCount: number
}

export type FeedPoll = {
  options: FeedPollOption[]
  totalVotes: number
  viewerOptionId: string | null
}

export type FeedMention = {
  profileId: string
  slug: string
  fullName: string
}

/** An organization tagged with @ in a post or comment (round 9B). */
export type FeedOrganizationMention = {
  companyId: string
  slug: string
  name: string
  logoUrl: string | null
}

/** A member tagged in one of the post's photos (round 9B). */
export type FeedPhotoTag = {
  mediaId: string
  profileId: string
  slug: string
  fullName: string
  avatarUrl?: string | null
}

/** The community group a post was published in (round 9B). */
export type FeedGroupRef = {
  id: string
  slug: string
  name: string
  visibility: 'public' | 'private'
  /** Community photo URL (round 9C), or null for the icon fallback. */
  iconUrl: string | null
}

export type FeedCommentReplyTarget = {
  commentId: string
  authorName: string
  authorSlug: string | null
}

export type FeedComment = {
  id: string
  body: string
  createdAt: string
  /** Compatibility defaults are hydrated by the mapper while older fixtures roll forward. */
  updatedAt?: string
  viewerOwns?: boolean
  canEdit?: boolean
  deleted?: boolean
  author: FeedAuthor
  parentCommentId?: string | null
  /** The specific comment this reply answers when it is not the top-level comment. */
  replyTo?: FeedCommentReplyTarget | null
  reactionSummary?: ReactionSummary
  reactionCount?: number
  viewerReaction?: PostReactionType | null
  mentions?: FeedMention[]
  organizationMentions?: FeedOrganizationMention[]
  replies?: FeedComment[]
}

export type FeedRepostSource = {
  id: string
  category: PostCategory
  body: string
  postType: 'standard' | 'poll'
  createdAt: string
  updatedAt: string
  author: FeedAuthor
  media: FeedMedia | null
  mediaItems?: FeedMedia[]
  poll: FeedPoll | null
  mentions?: FeedMention[]
  organizationMentions?: FeedOrganizationMention[]
  hashtags?: string[]
  photoTags?: FeedPhotoTag[]
  organization?: FeedOrganization | null
  group?: FeedGroupRef | null
}

export type FeedPost = {
  id: string
  category: PostCategory
  body: string
  postType: FeedPostType
  /** Who can see the post (round F); absent on older fixtures, which count as members only. */
  audience?: PostAudience
  createdAt: string
  updatedAt: string
  author: FeedAuthor
  media: FeedMedia | null
  mediaItems?: FeedMedia[]
  poll: FeedPoll | null
  repostOf?: FeedRepostSource | null
  reactionSummary?: ReactionSummary
  reactionCount?: number
  viewerReaction?: PostReactionType | null
  /** Compatibility fields retained while old fixtures/cached shapes roll forward. */
  likeCount: number
  viewerLiked: boolean
  commentCount: number
  viewerSaved: boolean
  viewerOwns?: boolean
  /** Published as an organization: show the organization instead of the person. */
  organization?: FeedOrganization | null
  /** The viewer may edit this post (its author, or an admin of its organization). */
  viewerCanEdit?: boolean
  /** The viewer may delete this post (its author, or an admin of its organization). */
  viewerCanDelete?: boolean
  /** True when the signed-in viewer follows this post's author. */
  viewerFollowsAuthor?: boolean
  mentions?: FeedMention[]
  /** Organizations tagged with @ in the text. */
  organizationMentions?: FeedOrganizationMention[]
  /** Normalised (lower-case) hashtags found in the text, in order of first appearance. */
  hashtags?: string[]
  /** Members tagged in the post's photos. */
  photoTags?: FeedPhotoTag[]
  /** The community group this post was published in, or null for the open feed. */
  group?: FeedGroupRef | null
  /** The viewer administers the post's group and may remove the post from it (round 9B). */
  viewerCanModerateGroup?: boolean
  comments: FeedComment[]
  /**
   * Round G: false when `comments` is only a preview (the top 2 comments) and the rest load on
   * demand; absent or true when every comment is loaded.
   */
  commentsComplete?: boolean
  /** Round DB: with a partial comment load, how many top-level comments the post has (for "View N more comments"). */
  commentRootCount?: number
  /** Round G "Top for you": why the post is shown, and the collapsed reposts label. */
  rank?: FeedPostRank | null
  /** Round I (I1): the job this post shares ("Share to feed"), shown as a job card with an Apply button. */
  jobShare?: FeedJobShare | null
}

export type FeedJobShare = {
  jobId: string
  title: string
  companyName: string
  location: string | null
  /** False once the job is closed, expired, deleted or hidden: the card says "This job is closed". */
  open: boolean
}

export type FeedPostRank = {
  /** One or two plain lines for "Why am I seeing this?". */
  reasons: string[]
  /** "<name> and N others reposted" when several reposts collapsed into this card. */
  repostedBy: { actorName: string; others: number } | null
  /** Admin-only ?rankdebug=1 data: the score and its parts. */
  debug?: { version: string; score: number; parts: Record<string, number> } | null
}

export type RecentlyDeletedPost = {
  id: string
  category: PostCategory
  body: string
  deletedAt: string
  purgeAfter: string
}

/** A post the viewer hid from their feed, as listed under My Activities › Hidden posts. */
export type HiddenPost = {
  id: string
  /** The post text, or for a plain repost the original post's text. */
  body: string
  isRepost: boolean
  createdAt: string
  hiddenAt: string
  author: Pick<FeedAuthor, 'id' | 'slug' | 'fullName' | 'avatarUrl'>
  organization: FeedOrganization | null
  /** First photo or video of the post (or of the original it reposts). */
  thumbnail: { url: string; mimeType: string } | null
}

export type FeedPage = {
  posts: FeedPost[]
  nextCursor: FeedCursor | null
  /** Round G: present on "Top for you" pages. */
  top?: TopFeedState
  /** Round G: present on Recent pages of the home feed. */
  recent?: RecentFeedState
}

export type FeedMode = 'top' | 'recent'

/** Where a "Top for you" visit is: its snapshot, the next position, and what the end looks like. */
export type TopFeedState = {
  sessionId: string
  visitId: string
  /** Next position in the snapshot, or null when the member has seen everything there is. */
  nextPosition: number | null
  stage: 'ranked' | 'wider' | 'explore' | 'caught_up'
  /** True once nothing unseen is left: show "You're all caught up". */
  caughtUp: boolean
  /** Few connections or no engagement yet: the feed shows the "improve your feed" card. */
  coldStart: boolean
  /** When the snapshot was built; "N new posts" counts unseen posts after it. */
  snapshotAt: string
}

export type RecentFeedState = {
  /** The first post at or before the member's previous visit: the "New since your last visit" divider goes above it. */
  dividerBeforePostId: string | null
}

/**
 * Round 14 (3.7): one item of a keyset-paginated list together with its own sort position, so a
 * refreshed first page can be merged with the pages the member already loaded.
 */
export type CursorPageEntry<T> = { cursor: FeedCursor; item: T }

/** A keyset page: newest first, `nextCursor` is null on the last page. */
export type CursorPage<T> = {
  entries: CursorPageEntry<T>[]
  nextCursor: FeedCursor | null
}

export type FeedRequest = {
  category?: PostCategory
  /** Only posts published as this organization. */
  companyId?: string
  /** Only posts published in this community group. */
  groupId?: string
  /** Only posts carrying this normalised hashtag (public posts, newest first). */
  hashtag?: string
  cursor?: FeedCursor
  limit?: number
}
