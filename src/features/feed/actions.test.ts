import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  createPendingPostMediaUpload,
  removeFeedImage,
  uploadFeedImage,
  verifyPendingPostMedia,
} from './media'
import {
  addPostCommentWithAurora,
  createPollPostWithAurora,
  createStandardPostWithAurora,
  deletePostWithAurora,
  setPollVoteWithAurora,
  setPostLikedWithAurora,
  setPostSavedWithAurora,
} from './service'
import {
  addComment,
  createPost,
  createPostMediaUpload,
  deletePost,
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
  createPendingPostMediaUpload: vi.fn(async (input: { profileId: string; mimeType: string; size: number }) => ({
    postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    storagePath: `${input.profileId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg`,
    mimeType: input.mimeType,
    size: input.size,
    uploadUrl: 'https://s3.example/upload',
  })),
  verifyPendingPostMedia: vi.fn(async () => undefined),
  uploadFeedImage: vi.fn(async () => 'legacy-server-upload-must-not-run'),
  removeFeedImage: vi.fn(async () => undefined),
}))
vi.mock('./service', () => ({
  createStandardPostWithAurora: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  createPollPostWithAurora: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  deletePostWithAurora: vi.fn(async () => true),
  setPostLikedWithAurora: vi.fn(async () => true),
  setPostSavedWithAurora: vi.fn(async () => true),
  addPostCommentWithAurora: vi.fn(async () => true),
  setPollVoteWithAurora: vi.fn(async () => true),
}))

const viewerId = '11111111-1111-4111-8111-111111111111'
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const optionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const objectId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const storagePath = `${viewerId}/${postId}/${objectId}.jpg`
const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedCreatePendingPostMediaUpload = vi.mocked(createPendingPostMediaUpload)
const mockedVerifyPendingPostMedia = vi.mocked(verifyPendingPostMedia)
const mockedUploadFeedImage = vi.mocked(uploadFeedImage)
const mockedRemoveFeedImage = vi.mocked(removeFeedImage)
const mockedCreateStandardPost = vi.mocked(createStandardPostWithAurora)
const mockedCreatePollPost = vi.mocked(createPollPostWithAurora)
const mockedDeletePost = vi.mocked(deletePostWithAurora)
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

function postFormWithCompletedMedia() {
  const formData = basePostForm()
  formData.set('mediaPostId', postId)
  formData.set('mediaStoragePath', storagePath)
  formData.set('mediaMimeType', 'image/jpeg')
  formData.set('mediaSize', '1024')
  formData.set('altText', 'Annotated engine-room diagram')
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

  it('rejects invalid media metadata before authenticating a presign request', async () => {
    await expect(createPostMediaUpload({ mimeType: 'image/gif', size: 1024 })).resolves.toEqual({
      ok: false,
      error: 'Choose a JPEG, PNG, WebP, MP4, or WebM file.',
    })

    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedCreatePendingPostMediaUpload).not.toHaveBeenCalled()
  })

  it('creates an authenticated server-owned pending upload reference', async () => {
    await expect(createPostMediaUpload({ mimeType: 'image/jpeg', size: 1024 })).resolves.toEqual({
      ok: true,
      upload: {
        postId,
        storagePath,
        mimeType: 'image/jpeg',
        size: 1024,
        uploadUrl: 'https://s3.example/upload',
      },
    })

    expect(mockedCreatePendingPostMediaUpload).toHaveBeenCalledWith({
      profileId: viewerId,
      mimeType: 'image/jpeg',
      size: 1024,
    })
  })

  it('rejects media attached to a technical poll before mutation', async () => {
    const formData = postFormWithCompletedMedia()
    formData.set('mode', 'poll')
    formData.append('pollOption', 'Option A')
    formData.append('pollOption', 'Option B')

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.media?.[0]).toMatch(/polls cannot include media/i)
    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedCreatePollPost).not.toHaveBeenCalled()
  })

  it('rejects media descriptions over 300 characters before mutation', async () => {
    const formData = postFormWithCompletedMedia()
    formData.set('altText', 'a'.repeat(301))

    const state = await createPost({}, formData)

    expect(state.fieldErrors?.media?.[0]).toMatch(/300/i)
    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedCreateStandardPost).not.toHaveBeenCalled()
  })

  it('creates a standard post through Aurora using the permanent profile UUID', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const state = await createPost({}, basePostForm())

    expect(state).toEqual({ ok: true })
    expect(mockedCreateStandardPost).toHaveBeenCalledWith(viewerId, {
      category: 'technical_discussion',
      body: 'A useful maritime technical lesson.',
    })
    expect(infoSpy).toHaveBeenCalledWith('[feed_publish_success]', expect.objectContaining({
      postId: expect.any(String),
      hasMedia: false,
    }))
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('A useful maritime technical lesson.')
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(viewerId)
    infoSpy.mockRestore()
  })

  it('verifies a completed direct upload before attaching the exact reference in Aurora', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const state = await createPost({}, postFormWithCompletedMedia())

    expect(state).toEqual({ ok: true })
    expect(mockedVerifyPendingPostMedia).toHaveBeenCalledWith({
      profileId: viewerId,
      postId,
      storagePath,
      mimeType: 'image/jpeg',
      size: 1024,
    })
    expect(mockedCreateStandardPost).toHaveBeenCalledWith(viewerId, {
      id: postId,
      category: 'technical_discussion',
      body: 'A useful maritime technical lesson.',
      media: {
        storagePath,
        mimeType: 'image/jpeg',
        altText: 'Annotated engine-room diagram',
      },
    })
    expect(mockedUploadFeedImage).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith('[feed_publish_success]', { postId, hasMedia: true })
    infoSpy.mockRestore()
  })

  it('does not mutate Aurora when completed media verification fails', async () => {
    mockedVerifyPendingPostMedia.mockRejectedValueOnce(new Error('feed_media_metadata_mismatch'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const state = await createPost({}, postFormWithCompletedMedia())

    expect(mockedCreateStandardPost).not.toHaveBeenCalled()
    expect(mockedRemoveFeedImage).not.toHaveBeenCalled()
    expect(state.error).toBe('We could not verify your uploaded media. Please upload it again.')
    expect(errorSpy).toHaveBeenCalledWith('[feed_publish_failed]', {
      stage: 'media_verify',
      postId,
      hasMedia: true,
      errorCode: 'feed_media_metadata_mismatch',
    })
    errorSpy.mockRestore()
  })

  it('removes directly uploaded media when Aurora post creation fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedCreateStandardPost.mockRejectedValueOnce(new Error('post_create_failed'))

    const state = await createPost({}, postFormWithCompletedMedia())

    expect(mockedRemoveFeedImage).toHaveBeenCalledWith(storagePath)
    expect(mockedUploadFeedImage).not.toHaveBeenCalled()
    expect(state.error).toBe('We could not attach your media, so the post was not published.')
    expect(errorSpy).toHaveBeenCalledWith('[feed_publish_failed]', expect.objectContaining({
      stage: 'aurora_create',
      postId,
      hasMedia: true,
      errorCode: 'post_create_failed',
    }))
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('A useful maritime technical lesson.')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(viewerId)
    errorSpy.mockRestore()
  })

  it('keeps the original publication error when compensating media cleanup also fails', async () => {
    mockedCreateStandardPost.mockRejectedValueOnce(new Error('post_create_failed'))
    mockedRemoveFeedImage.mockRejectedValueOnce(new Error('s3_delete_failed'))

    const state = await createPost({}, postFormWithCompletedMedia())

    expect(mockedRemoveFeedImage).toHaveBeenCalledWith(storagePath)
    expect(state.error).toBe('We could not attach your media, so the post was not published.')
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

  it('routes owner post deletion through the authenticated Aurora service', async () => {
    expect(await deletePost(postId)).toEqual({ ok: true })
    expect(mockedDeletePost).toHaveBeenCalledWith(viewerId, postId)
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
