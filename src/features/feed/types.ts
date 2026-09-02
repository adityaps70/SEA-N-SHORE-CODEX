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

export type FeedCursor = {
  createdAt: string
  id: string
}

export type FeedAuthor = {
  id: string
  slug: string
  fullName: string
  avatarPath: string | null
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

export type FeedComment = {
  id: string
  body: string
  createdAt: string
  author: FeedAuthor
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
  likeCount: number
  commentCount: number
  viewerLiked: boolean
  viewerSaved: boolean
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
