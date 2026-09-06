import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { removeFeedImage, uploadFeedImage } from './media'
import {
  addPostCommentWithAurora,
  createPollPostWithAurora,
  createStandardPostWithAurora,
  setPollVoteWithAurora,
  setPostLikedWithAurora,
  setPostSavedWithAurora,
} from './service'
import {
  addComment,
  createPost,
  setPollVote,
  setPostLiked,
  setPostSaved,
} from './actions'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    cognitoSub: 'cognito-subject-not-an-app-id',
    email: 'viewer@example.com',
  }
  return {
    requireAwsUser: vi.fn(async () => user),
    getAwsVerifiedUser: vi.fn(async () => user),
  }
})
vi.mock('./media', () => ({
  resolveFeedMediaUrls: vi.fn(async () => new Map()),
  uploadFeedImage: vi.fn(async () => '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/image.jpg'),
  removeFeedImage: vi.fn(async () => undefined),
}))
vi.mock('./service', () => ({
  createStandardPostWithAurora: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  createPollPostWithAurora: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  setPostLikedWithAurora: vi.fn(async () => true),
  setPostSavedWithAurora: vi.fn(async () => true),
  addPostCommentWithAurora: vi.fn(async () => true),
  setPollVoteWithAurora: vi.fn(async () => true),
}))

const viewerId = '11111111-1111-4111-8111-111111111111'
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const optionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const storagePath = `${viewerId}/${postId}/image.jpg`
const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedUploadFeedImage = vi.mocked(uploadFeedImage)
const mockedRemoveFeedImage = vi.mocked(removeFeedImage)
const mockedCreateStandardPost = vi.mocked(createStandardPostWithAurora)
const mockedCreatePollPost = vi.mocked(createPollPostWithAurora)
const mockedSetLiked = vi.mocked(setPostLikedWithAurora)
const mockedSetSaved = vi.mocked(setPostSavedWithAurora)
const mockedAddComment = vi.mocked(addPostCommentWithAurora)
const mockedSetVote = vi.mocked(setPollVoteWithAurora)

function basePostForm() {
  const formData = new FormData()
  formData.set('category', 'technical_discussion')
  formData.set('mode', 'standard')
  formData.set('body', 'A useful maritime technical lesson.')
  return formData
}

function postFormWithImage() {
  const formData = basePostForm()
  formData.set('media', new File(['image'], 'diagram.jpg', { type: 'image/jpeg' }))
  return formData
}

describe('feed actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not authenticate or mutate when a post body is invalid', async () => {
    const formData = basePostForm()
    formData.set('body', '   ')

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.body).toBeTruthy()
    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedCreateStandardPost).not.toHaveBeenCalled()
  })

  it.each([
    [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' }), /5 MiB/i],
    [new File(['gif'], 'animation.gif', { type: 'image/gif' }), /JPEG, PNG, or WebP/i],
  ])('rejects invalid media before authentication or mutation', async (file, message) => {
    const formData = basePostForm()
    formData.set('media', file)

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.media?.[0]).toMatch(message)
    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedCreateStandardPost).not.toHaveBeenCalled()
  })

  it('rejects an image attached to a technical poll before mutation', async () => {
    const formData = basePostForm()
    formData.set('mode', 'poll')
    formData.append('pollOption', 'Option A')
    formData.append('pollOption', 'Option B')
    formData.set('media', new File(['image'], 'diagram.png', { type: 'image/png' }))

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.media?.[0]).toMatch(/polls cannot include an image/i)
    expect(mockedCreatePollPost).not.toHaveBeenCalled()
  })

  it('rejects image descriptions over 300 characters before mutation', async () => {
    const formData = basePostForm()
    formData.set('media', new File(['image'], 'diagram.webp', { type: 'image/webp' }))
    formData.set('altText', 'a'.repeat(301))

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.media?.[0]).toMatch(/300 characters/i)
    expect(mockedCreateStandardPost).not.toHaveBeenCalled()
  })

  it('creates a standard post through Aurora using the permanent profile UUID', async () => {
    const state = await createPost({}, basePostForm())

    expect(state).toEqual({ ok: true })
    expect(mockedCreateStandardPost).toHaveBeenCalledWith(viewerId, {
      category: 'technical_discussion',
      body: 'A useful maritime technical lesson.',
    })
  })

  it('uploads media for the permanent profile and removes it when Aurora post creation fails', async () => {
    mockedCreateStandardPost.mockRejectedValueOnce(new Error('post_create_failed'))

    const state = await createPost({}, postFormWithImage())

    expect(mockedUploadFeedImage).toHaveBeenCalledWith(expect.objectContaining({
      profileId: viewerId,
      file: expect.any(File),
      extension: 'jpg',
    }))
    expect(mockedRemoveFeedImage).toHaveBeenCalledWith(storagePath)
    expect(state.error).toBe('We could not attach your image, so the post was not published.')
  })

  it('keeps the original publication error when compensating media cleanup also fails', async () => {
    mockedCreateStandardPost.mockRejectedValueOnce(new Error('post_create_failed'))
    mockedRemoveFeedImage.mockRejectedValueOnce(new Error('s3_delete_failed'))

    const state = await createPost({}, postFormWithImage())

    expect(mockedRemoveFeedImage).toHaveBeenCalledWith(storagePath)
    expect(state.error).toBe('We could not attach your image, so the post was not published.')
  })

  it('creates a poll through Aurora using normalized options and the permanent profile UUID', async () => {
    const formData = basePostForm()
    formData.set('mode', 'poll')
    formData.append('pollOption', ' Mooring ')
    formData.append('pollOption', 'Bridge')

    const state = await createPost({}, formData)

    expect(state).toEqual({ ok: true })
    expect(mockedCreatePollPost).toHaveBeenCalledWith(viewerId, {
      category: 'technical_discussion',
      body: 'A useful maritime technical lesson.',
      pollOptions: ['Mooring', 'Bridge'],
    })
  })

  it('routes like and save toggles through the Aurora service with the permanent UUID', async () => {
    expect(await setPostLiked(postId, false)).toEqual({ ok: true })
    expect(await setPostSaved(postId, true)).toEqual({ ok: true })

    expect(mockedSetLiked).toHaveBeenCalledWith(viewerId, postId, false)
    expect(mockedSetSaved).toHaveBeenCalledWith(viewerId, postId, true)
  })

  it('routes comments and poll votes through Aurora with the permanent UUID', async () => {
    const formData = new FormData()
    formData.set('postId', postId)
    formData.set('body', 'Useful lesson.')

    expect(await addComment({}, formData)).toEqual({ ok: true })
    expect(await setPollVote(postId, optionId)).toEqual({ ok: true })
    expect(mockedAddComment).toHaveBeenCalledWith(viewerId, postId, 'Useful lesson.')
    expect(mockedSetVote).toHaveBeenCalledWith(viewerId, postId, optionId)
  })

  it('preserves safe UI error copy when an Aurora mutation fails', async () => {
    mockedSetLiked.mockRejectedValueOnce(new Error('feed_interaction_unavailable'))
    expect(await setPostLiked(postId, true)).toEqual({ ok: false, error: 'We could not update your like.' })
  })
})
