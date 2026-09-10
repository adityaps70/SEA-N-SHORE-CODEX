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

export const POST_REACTIONS = ['like', 'support', 'respect', 'on_point'] as const
export type PostReactionType = (typeof POST_REACTIONS)[number]
export type ReactionSummary = Record<PostReactionType, number>

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

export type FeedMedia = {
  storagePath: string
  mimeType: string
  altText: string | null
  signedUrl: string | null
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

export type FeedComment = {
  id: string
  body: string
  createdAt: string
  author: FeedAuthor
  parentCommentId?: string | null
  reactionSummary?: ReactionSummary
  reactionCount?: number
  viewerReaction?: PostReactionType | null
  mentions?: FeedMention[]
  replies?: FeedComment[]
}

export type FeedPost = {
  id: string
  category: PostCategory
  body: string
  postType: 'standard' | 'poll'
  createdAt: string
  updatedAt: string
  author: FeedAuthor
  media: FeedMedia | null
  poll: FeedPoll | null
  reactionSummary?: ReactionSummary
  reactionCount?: number
  viewerReaction?: PostReactionType | null
  /** Compatibility fields retained while old fixtures/cached shapes roll forward. */
  likeCount: number
  viewerLiked: boolean
  commentCount: number
  viewerSaved: boolean
  viewerOwns?: boolean
  mentions?: FeedMention[]
  comments: FeedComment[]
}

export type FeedPage = {
  posts: FeedPost[]
  nextCursor: FeedCursor | null
}

export type FeedRequest = {
  category?: PostCategory
  cursor?: FeedCursor
  limit?: number
}
