import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createPost, setPostLiked } from './actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/queries', () => ({
  requireUser: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))

const mockedCreateServerSupabaseClient = vi.mocked(createServerSupabaseClient)

function basePostForm() {
  const formData = new FormData()
  formData.set('category', 'technical_discussion')
  formData.set('mode', 'standard')
  formData.set('body', 'A useful maritime technical lesson.')
  return formData
}

describe('feed actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not call Supabase when a post body is invalid', async () => {
    const formData = new FormData()
    formData.set('category', 'technical_discussion')
    formData.set('mode', 'standard')
    formData.set('body', '   ')

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.body).toBeTruthy()
    expect(mockedCreateServerSupabaseClient).not.toHaveBeenCalled()
  })

  it('rejects images larger than 5 MiB before any Supabase write', async () => {
    const formData = basePostForm()
    formData.set('media', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' }))

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.media?.[0]).toMatch(/5 MiB/i)
    expect(mockedCreateServerSupabaseClient).not.toHaveBeenCalled()
  })

  it('rejects GIF media before any Supabase write', async () => {
    const formData = basePostForm()
    formData.set('media', new File(['gif'], 'animation.gif', { type: 'image/gif' }))

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.media?.[0]).toMatch(/JPEG, PNG, or WebP/i)
    expect(mockedCreateServerSupabaseClient).not.toHaveBeenCalled()
  })

  it('rejects an image attached to a technical poll', async () => {
    const formData = basePostForm()
    formData.set('mode', 'poll')
    formData.append('pollOption', 'Option A')
    formData.append('pollOption', 'Option B')
    formData.set('media', new File(['image'], 'diagram.png', { type: 'image/png' }))

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.media?.[0]).toMatch(/polls cannot include an image/i)
    expect(mockedCreateServerSupabaseClient).not.toHaveBeenCalled()
  })

  it('rejects image descriptions over 300 characters', async () => {
    const formData = basePostForm()
    formData.set('media', new File(['image'], 'diagram.webp', { type: 'image/webp' }))
    formData.set('altText', 'a'.repeat(301))

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.media?.[0]).toMatch(/300 characters/i)
    expect(mockedCreateServerSupabaseClient).not.toHaveBeenCalled()
  })

  it.each([
    ['image/jpeg', 'photo.jpg'],
    ['image/png', 'diagram.png'],
    ['image/webp', 'photo.webp'],
  ])('accepts %s media and reaches the upload path', async (mimeType, fileName) => {
    const upload = vi.fn(async () => ({ error: { message: 'stop after validation' } }))
    const fromStorage = vi.fn(() => ({ upload }))
    mockedCreateServerSupabaseClient.mockResolvedValue({
      storage: { from: fromStorage },
      from: vi.fn(),
    } as never)

    const formData = basePostForm()
    formData.set('media', new File(['image'], fileName, { type: mimeType }))

    const state = await createPost({}, formData)

    expect(fromStorage).toHaveBeenCalledWith('post-media')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(state.error).toMatch(/could not upload/i)
  })

  it('deletes only the signed-in user reaction when unliking', async () => {
    const userEq = vi.fn(async () => ({ error: null }))
    const postEq = vi.fn(() => ({ eq: userEq }))
    const deleteReaction = vi.fn(() => ({ eq: postEq }))
    const from = vi.fn(() => ({ delete: deleteReaction }))
    mockedCreateServerSupabaseClient.mockResolvedValue({ from } as never)

    const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const result = await setPostLiked(postId, false)

    expect(result).toEqual({ ok: true })
    expect(postEq).toHaveBeenCalledWith('post_id', postId)
    expect(userEq).toHaveBeenCalledWith('user_id', '11111111-1111-4111-8111-111111111111')
  })
})
