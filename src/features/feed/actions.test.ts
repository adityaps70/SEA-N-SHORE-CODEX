import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  createPendingPostMediaUpload,
  removeFeedImage,
  uploadFeedImage,
  verifyPendingPostMedia,
} from './media'
import { getPostById } from './queries'
import {
  addPostCommentWithAurora,
  assertPendingMediaDiscardableWithAurora,
  createPollPostWithAurora,
  createStandardPostWithAurora,
  deleteCommentWithAurora,
  deletePostWithAurora,
  setPollVoteWithAurora,
  setPostLikedWithAurora,
  setPostSavedWithAurora,
  updateCommentWithAurora,
} from './service'
import {
  addComment,
  createPost,
  createPostMediaUpload,
  deletePost,
  discardPendingPostMedia,
  setPollVote,
  setPostLiked,
  setPostSaved,
} from './actions'
import * as feedActions from './actions'

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
vi.mock('./queries', () => ({
  getFeedPage: vi.fn(),
  getPostById: vi.fn(),
}))
vi.mock('./service', () => ({
  createStandardPostWithAurora: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  assertPendingMediaDiscardableWithAurora: vi.fn(async () => true),
  createPollPostWithAurora: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  deletePostWithAurora: vi.fn(async () => true),
  setPostLikedWithAurora: vi.fn(async () => true),
  setPostReactionWithAurora: vi.fn(async () => true),
  setPostSavedWithAurora: vi.fn(async () => true),
  addPostCommentWithAurora: vi.fn(async () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  updateCommentWithAurora: vi.fn(async () => ({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    parentCommentId: null,
  })),
  deleteCommentWithAurora: vi.fn(async () => ({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    parentCommentId: null,
  })),
  setCommentReactionWithAurora: vi.fn(async () => true),
  setPollVoteWithAurora: vi.fn(async () => true),
}))

const viewerId = '11111111-1111-4111-8111-111111111111'
const otherViewerId = '22222222-2222-4222-8222-222222222222'
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const optionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const objectId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const commentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const mentionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const storagePath = `${viewerId}/${postId}/${objectId}.jpg`
const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedCreatePendingPostMediaUpload = vi.mocked(createPendingPostMediaUpload)
const mockedVerifyPendingPostMedia = vi.mocked(verifyPendingPostMedia)
const mockedUploadFeedImage = vi.mocked(uploadFeedImage)
const mockedRemoveFeedImage = vi.mocked(removeFeedImage)
const mockedGetPostById = vi.mocked(getPostById)
const mockedCreateStandardPost = vi.mocked(createStandardPostWithAurora)
const mockedAssertPendingMediaDiscardable = vi.mocked(assertPendingMediaDiscardableWithAurora)
const mockedCreatePollPost = vi.mocked(createPollPostWithAurora)
const mockedDeletePost = vi.mocked(deletePostWithAurora)
const mockedSetLiked = vi.mocked(setPostLikedWithAurora)
const mockedSetSaved = vi.mocked(setPostSavedWithAurora)
const mockedAddComment = vi.mocked(addPostCommentWithAurora)
const mockedUpdateComment = vi.mocked(updateCommentWithAurora)
const mockedDeleteComment = vi.mocked(deleteCommentWithAurora)
const mockedSetVote = vi.mocked(setPollVoteWithAurora)

const hydratedComment = {
  id: commentId,
  body: 'Useful lesson.',
  createdAt: '2026-09-10T09:00:00.000Z',
  updatedAt: '2026-09-10T09:00:00.000Z',
  viewerOwns: true,
  canEdit: true,
  deleted: false,
  author: {
    id: viewerId,
    slug: 'viewer',
    fullName: 'Viewer Member',
    avatarPath: null,
    avatarUrl: null,
    headline: 'Chief Officer',
    rank: 'Chief Officer',
    currentCompany: 'Example Shipping',
  },
  parentCommentId: null,
  reactionSummary: { like: 0, support: 0, respect: 0, on_point: 0 },
  reactionCount: 0,
  viewerReaction: null,
  mentions: [],
} as const

function hydratedPost(comments: readonly unknown[] = [hydratedComment]) {
  return { comments } as never
}

type CommentActionState = {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string[] | undefined>
  value?: string
  comment?: typeof hydratedComment
}

type CommentManagementActions = {
  updateComment(previousState: CommentActionState, formData: FormData): Promise<CommentActionState>
  deleteComment(commentId: string): Promise<{ ok: boolean; error?: string; commentId?: string; comment?: typeof hydratedComment | null }>
}

const managedActions = feedActions as unknown as CommentManagementActions

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

function commentEditForm() {
  const formData = new FormData()
  formData.set('commentId', commentId)
  formData.set('body', '  Updated bridge note.  ')
  formData.append('mentionProfileId', mentionId)
  formData.append('mentionProfileId', mentionId)
  return formData
}

describe('feed actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetPostById.mockResolvedValue(hydratedPost())
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

  it('discards only an authenticated pending object scoped to the current user and post', async () => {
    await expect(discardPendingPostMedia({ postId, storagePath, mimeType: 'image/jpeg' })).resolves.toEqual({ ok: true })
    expect(mockedAssertPendingMediaDiscardable).toHaveBeenCalledWith(viewerId, storagePath)
    expect(mockedRemoveFeedImage).toHaveBeenCalledWith(storagePath)
  })

  it('rejects a pending object path outside the authenticated user scope before deletion', async () => {
    await expect(discardPendingPostMedia({
      postId,
      storagePath: `${otherViewerId}/${postId}/${objectId}.jpg`,
      mimeType: 'image/jpeg',
    })).resolves.toEqual({ ok: false, error: 'Invalid media.' })
    expect(mockedAssertPendingMediaDiscardable).not.toHaveBeenCalled()
    expect(mockedRemoveFeedImage).not.toHaveBeenCalled()
  })

  it('refuses to delete a pending object once Aurora already references it', async () => {
    mockedAssertPendingMediaDiscardable.mockRejectedValueOnce(new Error('feed_media_delete_forbidden'))
    await expect(discardPendingPostMedia({ postId, storagePath, mimeType: 'image/jpeg' })).resolves.toEqual({ ok: false, error: 'We could not remove this media.' })
    expect(mockedRemoveFeedImage).not.toHaveBeenCalled()
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
      mentionProfileIds: [],
    })
    expect(infoSpy).toHaveBeenCalledWith('[feed_publish_success]', expect.objectContaining({ postId: expect.any(String), hasMedia: false }))
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('A useful maritime technical lesson.')
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(viewerId)
    infoSpy.mockRestore()
  })

  it('verifies a completed direct upload before attaching the exact reference in Aurora', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const state = await createPost({}, postFormWithCompletedMedia())
    expect(state).toEqual({ ok: true })
    expect(mockedVerifyPendingPostMedia).toHaveBeenCalledWith({ profileId: viewerId, postId, storagePath, mimeType: 'image/jpeg', size: 1024 })
    expect(mockedCreateStandardPost).toHaveBeenCalledWith(viewerId, {
      id: postId,
      category: 'technical_discussion',
      body: 'A useful maritime technical lesson.',
      media: { storagePath, mimeType: 'image/jpeg', altText: 'Annotated engine-room diagram' },
      mentionProfileIds: [],
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
    expect(errorSpy).toHaveBeenCalledWith('[feed_publish_failed]', { stage: 'media_verify', postId, hasMedia: true, errorCode: 'feed_media_metadata_mismatch' })
    errorSpy.mockRestore()
  })

  it('removes directly uploaded media when Aurora post creation fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockedCreateStandardPost.mockRejectedValueOnce(new Error('post_create_failed'))
    const state = await createPost({}, postFormWithCompletedMedia())
    expect(mockedRemoveFeedImage).toHaveBeenCalledWith(storagePath)
    expect(mockedUploadFeedImage).not.toHaveBeenCalled()
    expect(state.error).toBe('We could not attach your media, so the post was not published.')
    expect(errorSpy).toHaveBeenCalledWith('[feed_publish_failed]', expect.objectContaining({ stage: 'aurora_create', postId, hasMedia: true, errorCode: 'post_create_failed' }))
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
      mentionProfileIds: [],
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

    expect(await addComment({}, formData)).toEqual({ ok: true, comment: hydratedComment })
    expect(await setPollVote(postId, optionId)).toEqual({ ok: true })
    expect(mockedAddComment).toHaveBeenCalledWith(viewerId, postId, 'Useful lesson.', null, [])
    expect(mockedGetPostById).toHaveBeenCalledWith(postId)
    expect(mockedSetVote).toHaveBeenCalledWith(viewerId, postId, optionId)
  })

  it('preserves safe UI error copy when an Aurora mutation fails', async () => {
    mockedSetLiked.mockRejectedValueOnce(new Error('feed_interaction_unavailable'))
    expect(await setPostLiked(postId, true)).toEqual({ ok: false, error: 'We could not update your like.' })
  })

  it('validates an edit before authentication and preserves the attempted body', async () => {
    const formData = commentEditForm()
    formData.set('commentId', 'not-a-uuid')
    const state = await managedActions.updateComment({}, formData)
    expect(state.fieldErrors?.commentId).toBeTruthy()
    expect(state.value).toBe('  Updated bridge note.  ')
    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedUpdateComment).not.toHaveBeenCalled()
  })

  it('routes an authenticated comment edit through Aurora with normalized body and mentions', async () => {
    const updatedComment = { ...hydratedComment, body: 'Updated bridge note.', updatedAt: '2026-09-10T09:02:00.000Z' }
    mockedGetPostById.mockResolvedValueOnce(hydratedPost([updatedComment]))
    const state = await managedActions.updateComment({}, commentEditForm())
    expect(state).toEqual({ ok: true, comment: updatedComment })
    expect(mockedUpdateComment).toHaveBeenCalledWith(viewerId, commentId, 'Updated bridge note.', [mentionId])
  })

  it('returns the exact 15-minute edit error without exposing the service code', async () => {
    mockedUpdateComment.mockRejectedValueOnce(new Error('feed_comment_edit_expired'))
    const state = await managedActions.updateComment({}, commentEditForm())
    expect(state).toEqual({ error: 'Comments can only be edited for 15 minutes after posting.', value: '  Updated bridge note.  ' })
    expect(JSON.stringify(state)).not.toContain('feed_comment_edit_expired')
  })

  it('uses generic edit copy for permission or unavailable-target failures', async () => {
    mockedUpdateComment.mockRejectedValueOnce(new Error('feed_comment_mutation_forbidden'))
    await expect(managedActions.updateComment({}, commentEditForm())).resolves.toEqual({ error: 'We could not update this comment.', value: '  Updated bridge note.  ' })
  })

  it('validates delete ids before authentication and routes valid deletes through Aurora', async () => {
    await expect(managedActions.deleteComment('not-a-uuid')).resolves.toEqual({ ok: false, error: 'Invalid comment.' })
    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedDeleteComment).not.toHaveBeenCalled()

    mockedGetPostById.mockResolvedValueOnce(hydratedPost([]))
    await expect(managedActions.deleteComment(commentId)).resolves.toEqual({ ok: true, commentId, comment: null })
    expect(mockedDeleteComment).toHaveBeenCalledWith(viewerId, commentId)
  })

  it('uses generic delete copy for permission or unavailable-target failures', async () => {
    mockedDeleteComment.mockRejectedValueOnce(new Error('feed_interaction_unavailable'))
    await expect(managedActions.deleteComment(commentId)).resolves.toEqual({ ok: false, error: 'We could not delete this comment.' })
  })
})