import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  assertEditableOwnedCourse: vi.fn(),
  isMediaReferenced: vi.fn(),
  createPendingLearningMediaUpload: vi.fn(),
  removeLearningMediaObject: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./media-repository', () => ({
  learningMediaRepository: {
    assertEditableOwnedCourse: mocks.assertEditableOwnedCourse,
    isMediaReferenced: mocks.isMediaReferenced,
  },
}))
vi.mock('./media', () => ({
  createPendingLearningMediaUpload: mocks.createPendingLearningMediaUpload,
  removeLearningMediaObject: mocks.removeLearningMediaObject,
}))

import { createLearningMediaUpload, discardLearningMediaUpload } from './media-actions'

const courseId = '33333333-3333-4333-8333-333333333333'
const storagePath = `learning/user-1/${courseId}/lesson_video/77777777-7777-4777-8777-777777777777.mp4`

describe('learning media server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', email: 'mentor@example.com' })
    mocks.assertEditableOwnedCourse.mockResolvedValue(true)
    mocks.isMediaReferenced.mockResolvedValue(false)
    mocks.createPendingLearningMediaUpload.mockResolvedValue({
      storagePath,
      mimeType: 'video/mp4',
      size: 1024,
      uploadUrl: 'https://upload.example.test',
    })
    mocks.removeLearningMediaObject.mockResolvedValue(undefined)
  })

  it('rejects an invalid course before authentication or S3 preparation', async () => {
    await expect(createLearningMediaUpload({ courseId: 'bad-course', kind: 'lesson_video', mimeType: 'video/mp4', size: 1024 })).resolves.toEqual({
      ok: false,
      error: 'Invalid course.',
    })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.createPendingLearningMediaUpload).not.toHaveBeenCalled()
  })

  it('authorizes an active mentor-owned editable course before preparing a direct upload', async () => {
    await expect(createLearningMediaUpload({ courseId, kind: 'lesson_video', mimeType: 'video/mp4', size: 1024 })).resolves.toEqual({
      ok: true,
      upload: expect.objectContaining({ storagePath, uploadUrl: 'https://upload.example.test' }),
    })

    expect(mocks.assertEditableOwnedCourse).toHaveBeenCalledWith('user-1', courseId)
    expect(mocks.createPendingLearningMediaUpload).toHaveBeenCalledWith({
      userId: 'user-1',
      courseId,
      kind: 'lesson_video',
      mimeType: 'video/mp4',
      size: 1024,
    })
  })

  it('never deletes a persisted media object that is still referenced by the course or a lesson', async () => {
    mocks.isMediaReferenced.mockResolvedValueOnce(true)

    await expect(discardLearningMediaUpload({ courseId, kind: 'lesson_video', storagePath })).resolves.toEqual({
      ok: false,
      error: 'This media is already attached to the course.',
    })
    expect(mocks.removeLearningMediaObject).not.toHaveBeenCalled()
  })

  it('deletes an unreferenced owned pending media object after course authorization', async () => {
    await expect(discardLearningMediaUpload({ courseId, kind: 'lesson_video', storagePath })).resolves.toEqual({ ok: true })

    expect(mocks.assertEditableOwnedCourse).toHaveBeenCalledWith('user-1', courseId)
    expect(mocks.isMediaReferenced).toHaveBeenCalledWith('user-1', courseId, storagePath)
    expect(mocks.removeLearningMediaObject).toHaveBeenCalledWith({ userId: 'user-1', courseId, kind: 'lesson_video', storagePath })
  })
})
