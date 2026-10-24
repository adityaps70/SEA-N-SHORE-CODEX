import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageReencodeError, IMAGE_REENCODE_ERROR_MESSAGE } from '@/lib/images/downscale-image'

const mocks = vi.hoisted(() => ({
  createLearningMediaUpload: vi.fn(),
  getLearningMediaReadUrl: vi.fn(),
  uploadLearningMediaFile: vi.fn(),
  downscaleImage: vi.fn(),
}))

vi.mock('../media-actions', () => ({
  createLearningMediaUpload: mocks.createLearningMediaUpload,
  discardLearningMediaUpload: vi.fn(),
  getLearningMediaReadUrl: mocks.getLearningMediaReadUrl,
}))
vi.mock('./upload-learning-media', () => ({ uploadLearningMediaFile: mocks.uploadLearningMediaFile }))
vi.mock('@/lib/images/downscale-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/images/downscale-image')>()),
  downscaleImage: mocks.downscaleImage,
}))

import { LearningMediaUploadField } from './learning-media-upload-field'

const courseId = '33333333-3333-4333-8333-333333333333'
const photo = new File([new Uint8Array(4_000)], 'IMG_0001.jpg', { type: 'image/jpeg' })
const reencoded = new File([new Uint8Array(1_000)], 'IMG_0001.webp', { type: 'image/webp' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createLearningMediaUpload.mockResolvedValue({ ok: true, upload: { uploadUrl: 'https://s3.example/put', storagePath: 'learning/courses/c/x.webp', mimeType: 'image/webp' } })
  mocks.uploadLearningMediaFile.mockResolvedValue(undefined)
  mocks.getLearningMediaReadUrl.mockResolvedValue({ ok: true, url: 'https://signed.example.com/x.webp' })
  mocks.downscaleImage.mockResolvedValue(reencoded)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function pick(kind: 'course_thumbnail' | 'certificate_signature' | 'lesson_video', file: File) {
  render(<LearningMediaUploadField courseId={courseId} kind={kind} label="Media" inputAriaLabel="Media file" value={null} onChange={vi.fn()} accept="*/*" previewType={kind === 'lesson_video' ? 'video' : 'image'} />)
  fireEvent.change(screen.getByLabelText('Media file'), { target: { files: [file] } })
}

describe('learning image uploads are always re-encoded (Round P3)', () => {
  it('uploads the re-encoded course thumbnail, never the picked photo with its EXIF', async () => {
    pick('course_thumbnail', photo)

    await waitFor(() => expect(mocks.uploadLearningMediaFile).toHaveBeenCalled())
    expect(mocks.downscaleImage).toHaveBeenCalledWith(photo, 'cover')
    expect(mocks.createLearningMediaUpload).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/webp', size: reencoded.size }))
    expect(mocks.uploadLearningMediaFile).toHaveBeenCalledWith(expect.objectContaining({ file: reencoded }))
  })

  it('keeps certificate artwork in a PDF-embeddable type', async () => {
    pick('certificate_signature', new File([new Uint8Array(10)], 'sig.png', { type: 'image/png' }))

    await waitFor(() => expect(mocks.downscaleImage).toHaveBeenCalledWith(expect.any(File), 'certificate'))
  })

  it('uploads a video as picked', async () => {
    const video = new File([new Uint8Array(10)], 'lesson.mp4', { type: 'video/mp4' })
    pick('lesson_video', video)

    await waitFor(() => expect(mocks.uploadLearningMediaFile).toHaveBeenCalledWith(expect.objectContaining({ file: video })))
    expect(mocks.downscaleImage).not.toHaveBeenCalled()
  })

  it('refuses a photo the browser cannot re-encode, before asking for an upload link', async () => {
    mocks.downscaleImage.mockRejectedValue(new ImageReencodeError())
    pick('course_thumbnail', photo)

    expect(await screen.findByText(IMAGE_REENCODE_ERROR_MESSAGE)).toBeInTheDocument()
    expect(mocks.createLearningMediaUpload).not.toHaveBeenCalled()
  })
})
