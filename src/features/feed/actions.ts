'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/features/auth/queries'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { commentInputSchema, createPostInputSchema, feedRequestSchema, pollVoteSchema } from './schemas'
import { getFeedPage } from './queries'
import type { FeedRequest, PostCategory } from './types'

export type FeedActionResult = { ok: true } | { ok: false; error: string }

export type PostComposerState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
  values?: {
    category?: PostCategory
    body?: string
    mode?: 'standard' | 'poll'
    pollOptions?: string[]
  }
}

export type CommentActionState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
  value?: string
}

function postInputFromFormData(formData: FormData) {
  const mode = formData.get('mode') === 'poll' ? 'poll' : 'standard'
  return {
    category: formData.get('category'),
    body: formData.get('body'),
    mode,
    pollOptions: formData.getAll('pollOption'),
  }
}

function safePostValues(formData: FormData): PostComposerState['values'] {
  const raw = postInputFromFormData(formData)
  const category = typeof raw.category === 'string' ? raw.category : undefined
  const allowedCategories: PostCategory[] = [
    'maritime_news', 'technical_discussion', 'vetting_sire_2_0', 'career_advice',
    'safety_lessons', 'achievement', 'learning', 'industry_opinion',
  ]
  return {
    category: allowedCategories.includes(category as PostCategory) ? category as PostCategory : undefined,
    body: typeof raw.body === 'string' && raw.body.length <= 5000 ? raw.body : undefined,
    mode: raw.mode,
    pollOptions: raw.pollOptions.flatMap((value) => typeof value === 'string' && value.length <= 120 ? [value] : []),
  }
}

export async function createPost(
  _previousState: PostComposerState,
  formData: FormData,
): Promise<PostComposerState> {
  const raw = postInputFromFormData(formData)
  const parsed = createPostInputSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      values: safePostValues(formData),
    }
  }

  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const data = parsed.data

  if (data.mode === 'poll') {
    const { error } = await supabase.rpc('create_poll_post', {
      p_category: data.category,
      p_body: data.body,
      p_options: data.pollOptions,
    })
    if (error) {
      return { error: 'We could not publish your poll. Your entries are still here.', values: safePostValues(formData) }
    }
  } else {
    const { error } = await supabase.from('posts').insert({
      id: crypto.randomUUID(),
      author_id: user.id,
      category: data.category,
      body: data.body,
      post_type: 'standard',
    })
    if (error) {
      return { error: 'We could not publish your post. Your entries are still here.', values: safePostValues(formData) }
    }
  }

  revalidatePath('/home')
  return { ok: true }
}

export async function loadFeedPage(input: FeedRequest) {
  const parsed = feedRequestSchema.safeParse(input)
  if (!parsed.success) return { ok: false as const, error: 'The next feed page request was invalid.' }
  try {
    const page = await getFeedPage(parsed.data)
    return { ok: true as const, page }
  } catch {
    return { ok: false as const, error: 'We could not load more posts.' }
  }
}

const postIdSchema = z.string().uuid()

export async function setPostLiked(postId: string, liked: boolean): Promise<FeedActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  if (!parsedId.success || typeof liked !== 'boolean') return { ok: false, error: 'Invalid post.' }
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  if (liked) {
    const { error } = await supabase.from('post_reactions').insert({
      post_id: parsedId.data,
      user_id: user.id,
      reaction_type: 'like',
    })
    if (error && error.code !== '23505') return { ok: false, error: 'We could not update your like.' }
  } else {
    const { error } = await supabase
      .from('post_reactions')
      .delete()
      .eq('post_id', parsedId.data)
      .eq('user_id', user.id)
    if (error) return { ok: false, error: 'We could not update your like.' }
  }

  revalidatePath('/home')
  return { ok: true }
}

export async function setPostSaved(postId: string, saved: boolean): Promise<FeedActionResult> {
  const parsedId = postIdSchema.safeParse(postId)
  if (!parsedId.success || typeof saved !== 'boolean') return { ok: false, error: 'Invalid post.' }
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()

  if (saved) {
    const { error } = await supabase.from('saved_posts').insert({ post_id: parsedId.data, user_id: user.id })
    if (error && error.code !== '23505') return { ok: false, error: 'We could not update your saved posts.' }
  } else {
    const { error } = await supabase
      .from('saved_posts')
      .delete()
      .eq('post_id', parsedId.data)
      .eq('user_id', user.id)
    if (error) return { ok: false, error: 'We could not update your saved posts.' }
  }

  revalidatePath('/home')
  return { ok: true }
}

export async function addComment(
  _previousState: CommentActionState,
  formData: FormData,
): Promise<CommentActionState> {
  const raw = { postId: formData.get('postId'), body: formData.get('body') }
  const parsed = commentInputSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      value: typeof raw.body === 'string' && raw.body.length <= 2000 ? raw.body : undefined,
    }
  }

  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('post_comments').insert({
    post_id: parsed.data.postId,
    author_id: user.id,
    body: parsed.data.body,
  })
  if (error) return { error: 'We could not add your comment.', value: parsed.data.body }

  revalidatePath('/home')
  return { ok: true }
}

export async function setPollVote(postId: string, optionId: string): Promise<FeedActionResult> {
  const parsed = pollVoteSchema.safeParse({ postId, optionId })
  if (!parsed.success) return { ok: false, error: 'Invalid poll option.' }
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('post_poll_votes').upsert({
    post_id: parsed.data.postId,
    option_id: parsed.data.optionId,
    user_id: user.id,
  }, { onConflict: 'post_id,user_id' })
  if (error) return { ok: false, error: 'We could not record your vote.' }

  revalidatePath('/home')
  return { ok: true }
}
