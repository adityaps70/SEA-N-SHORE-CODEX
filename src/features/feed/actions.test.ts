import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createPost, setPostLiked } from './actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/queries', () => ({
  requireUser: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))

const mockedCreateServerSupabaseClient = vi.mocked(createServerSupabaseClient)

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
