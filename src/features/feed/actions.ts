'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/features/auth/queries'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { commentInputSchema, createPostInputSchema, feedRequestSchema, pollVoteSchema } from './schemas'
import { getFeedPage } from './queries'
import { POST_CATEGORIES, type FeedRequest, type PostCategory } from './types'

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

const extensionByMime = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

type AllowedImageMime = keyof typeof extensionByMime

function isAllowedImageMime(value: string): value is AllowedImageMime {
  return value in extensionByMime
}

function postInputFromFormData(formData: FormData) {
  const mode: 'standard' | 'poll' = formData.get('mode') === 'poll' ? 'poll' : 'standard'
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
  return {
    category: POST_CATEGORIES.includes(category as PostCategory) ? category as PostCategory : undefined,
    body: typeof raw.body === 'string' && raw.body.length <= 5000 ? raw.body : undefined,
    mode: raw.mode,
    pollOptions: raw.pollOptions.flatMap((value) => typeof value === 'string' && value.length <= 120 ? [value] : []),
  }
}

function mediaInput(formData: FormData, mode: 'standard' | 'poll') {
  const candidate = formData.get('media')
  const media = candidate instanceof File && candidate.size > 0 ? candidate : null
  const altValue = formData.get('altText')
  const altText = typeof altValue === 'string' ? altValue.trim() : ''

  if (media && mode === 'poll') {
    return { error: 'Technical polls cannot include an image in this release.' } as const
  }
  if (altText.length > 300) {
    return { error: 'Keep the image description to 300 characters or fewer.' } as const
  }
  if (!media) return { media: null, altText: altText || null, extension: null } as const
  if (media.size > 5 * 1024 * 1024) {
    return { error: 'Images must be 5 MiB or smaller.' } as const
  }
  if (!isAllowedImageMime(media.type)) {
    return { error: 'Use a JPEG, PNG, or WebP image.' } as const
  }
  return { media, altText: altText || null, extension: extensionByMime[media.type] } as const
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

  const media = mediaInput(formData, parsed.data.mode)
  if ('error' in media && typeof media.error === 'string') {
    return { fieldErrors: { media: [media.error] }, values: safePostValues(formData) }
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
    const postId = crypto.randomUUID()
    let storagePath: string | null = null

    if (media.media && media.extension) {
      storagePath = `${user.id}/${postId}/${crypto.randomUUID()}.${media.extension}`
      const { error: uploadError } = await supabase.storage
        .from('post-media')
        .upload(storagePath, media.media, { contentType: media.media.type, upsert: false })
      if (uploadError) {
        return { error: 'We could not upload your image. Your post was not published.', values: safePostValues(formData) }
      }
    }

    const { error: postError } = await supabase.from('posts').insert({
      id: postId,
      author_id: user.id,
      category: data.category,
      body: data.body,
      post_type: 'standard',
    })

    if (postError) {
      if (storagePath) await supabase.storage.from('post-media').remove([storagePath])
      return { error: 'We could not publish your post. Your entries are still here.', values: safePostValues(formData) }
    }

    if (storagePath && media.media) {
      const { error: mediaError } = await supabase.from('post_media').insert({
        post_id: postId,
        storage_path: storagePath,
        mime_type: media.media.type,
        alt_text: media.altText,
      })
      if (mediaError) {
        await Promise.all([
          supabase.storage.from('post-media').remove([storagePath]),
          supabase.from('posts').update({ deleted_at: new Date().toISOString() }).eq('id', postId).eq('author_id', user.id),
        ])
        return { error: 'We could not attach your image, so the post was not published.', values: safePostValues(formData) }
      }
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
