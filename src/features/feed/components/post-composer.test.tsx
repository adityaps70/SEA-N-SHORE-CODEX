import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '@/features/profiles/types'
import { POST_IMAGE_MAX_BYTES, POST_VIDEO_MAX_BYTES } from '../media-policy'
import { PostComposer } from './post-composer'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  createPost: vi.fn(async () => ({ ok: true })),
  createPostMediaUpload: vi.fn(),
  discardPendingPostMedia: vi.fn(async () => ({ ok: true })),
  uploadPostMediaFile: vi.fn(async () => undefined),
  createObjectURL: vi.fn(() => 'blob:preview-media'),
  revokeObjectURL: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('../actions', () => ({
  createPost: mocks.createPost,
  createPostMediaUpload: mocks.createPostMediaUpload,
  discardPendingPostMedia: mocks.discardPendingPostMedia,
}))

vi.mock('./upload-post-media', () => ({
  uploadPostMediaFile: mocks.uploadPostMediaFile,
}))

const profile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
  location: 'Mumbai',
  headline: 'Chief Officer',
  summary: 'Experienced maritime professional with tanker operations experience.',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: null,
  sailingExperienceYears: 12,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: ['SIRE 2.0'],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
}

const imageUpload = {
  postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  storagePath: '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',
  mimeType: 'image/jpeg' as const,
  size: 1024,
  uploadUrl: 'https://s3.example/image-upload',
}

const videoUpload = {
  postId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  storagePath: '11111111-1111-4111-8111-111111111111/dddddddd-dddd-4ddd-8ddd-dddddddddddd/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.mp4',
  mimeType: 'video/mp4' as const,
  size: 2048,
  uploadUrl: 'https://s3.example/video-upload',
}

function mediaInput() {
  return screen.getByLabelText('Photo / Video') as HTMLInputElement
}

function fileWithSize(name: string, type: string, size: number) {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createPost.mockResolvedValue({ ok: true })
  mocks.createPostMediaUpload.mockImplementation(async ({ mimeType, size }: { mimeType: string; size: number }) => ({
    ok: true,
    upload: mimeType === 'video/mp4'
      ? { ...videoUpload, size }
      : { ...imageUpload, mimeType, size },
  }))
  mocks.discardPendingPostMedia.mockResolvedValue({ ok: true })
  mocks.uploadPostMediaFile.mockResolvedValue(undefined)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: mocks.createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: mocks.revokeObjectURL })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PostComposer', () => {
  it('offers one Photo / Video control with the exact supported MIME types', () => {
    render(<PostComposer profile={profile} />)

    expect(screen.getByPlaceholderText('Share a maritime update, technical lesson, or industry insight...')).toBeInTheDocument()
    expect(screen.queryByLabelText('Topic')).not.toBeInTheDocument()
    expect(screen.getByText('Photo / Video')).toBeInTheDocument()
    expect(mediaInput()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,video/mp4,video/webm')
    expect(mediaInput()).not.toHaveAttribute('name', 'media')
    expect(screen.getByRole('button', { name: 'Technical Poll' })).toBeInTheDocument()
  })

  it('uploads a portrait image directly, renders an uncropped preview, and exposes metadata only when ready', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    const file = fileWithSize('portrait.jpg', 'image/jpeg', 1024)

    await user.upload(mediaInput(), file)

    await waitFor(() => expect(mocks.uploadPostMediaFile).toHaveBeenCalledWith({
      uploadUrl: imageUpload.uploadUrl,
      file,
      onProgress: expect.any(Function),
    }))

    const preview = await screen.findByRole('img', { name: 'Selected post media preview' })
    expect(preview).toHaveAttribute('src', 'blob:preview-media')
    expect(preview).toHaveClass('object-contain')
    expect(screen.getByDisplayValue(imageUpload.postId)).toHaveAttribute('name', 'mediaPostId')
    expect(screen.getByDisplayValue(imageUpload.storagePath)).toHaveAttribute('name', 'mediaStoragePath')
    expect(screen.getByDisplayValue('image/jpeg')).toHaveAttribute('name', 'mediaMimeType')
    expect(screen.getByDisplayValue('1024')).toHaveAttribute('name', 'mediaSize')
  })

  it('renders an uploaded MP4 as an inline controls-enabled video preview', async () => {
    const user = userEvent.setup()
    const { container } = render(<PostComposer profile={profile} />)
    const file = fileWithSize('bridge.mp4', 'video/mp4', 2048)

    await user.upload(mediaInput(), file)

    await waitFor(() => expect(mocks.uploadPostMediaFile).toHaveBeenCalled())
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video).toHaveAttribute('src', 'blob:preview-media')
  })

  it('keeps Post disabled and does not expose finalization metadata while upload is unresolved', async () => {
    let finishUpload: (() => void) | undefined
    mocks.uploadPostMediaFile.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishUpload = resolve
    }))
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)

    await user.upload(mediaInput(), fileWithSize('portrait.webp', 'image/webp', 1024))

    await waitFor(() => expect(mocks.uploadPostMediaFile).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(screen.getByText(/Uploading/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /mediaPostId/i })).not.toBeInTheDocument()
    expect(document.querySelector('input[name="mediaPostId"]')).toBeNull()

    finishUpload?.()
    await waitFor(() => expect(document.querySelector('input[name="mediaPostId"]')).not.toBeNull())
  })

  it('reports upload progress from the XHR progress callback', async () => {
    let reportProgress: ((percent: number) => void) | undefined
    let finishUpload: (() => void) | undefined
    mocks.uploadPostMediaFile.mockImplementationOnce(({ onProgress }: { onProgress: (percent: number) => void }) => {
      reportProgress = onProgress
      return new Promise<void>((resolve) => { finishUpload = resolve })
    })
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)

    await user.upload(mediaInput(), fileWithSize('engine.png', 'image/png', 1024))
    await waitFor(() => expect(reportProgress).toBeDefined())
    reportProgress?.(42)
    expect(await screen.findByText(/42%/)).toBeInTheDocument()
    finishUpload?.()
  })

  it('removes a ready preview and best-effort discards its pending S3 object', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.upload(mediaInput(), fileWithSize('portrait.jpg', 'image/jpeg', 1024))
    await screen.findByRole('img', { name: 'Selected post media preview' })

    await user.click(screen.getByRole('button', { name: 'Remove media' }))

    expect(mocks.discardPendingPostMedia).toHaveBeenCalledWith({
      postId: imageUpload.postId,
      storagePath: imageUpload.storagePath,
      mimeType: 'image/jpeg',
    })
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:preview-media')
    expect(screen.queryByRole('img', { name: 'Selected post media preview' })).not.toBeInTheDocument()
  })

  it('switching to Technical Poll clears and discards a ready pending media object', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.upload(mediaInput(), fileWithSize('portrait.jpg', 'image/jpeg', 1024))
    await screen.findByRole('img', { name: 'Selected post media preview' })

    await user.click(screen.getByRole('button', { name: 'Technical Poll' }))

    expect(mocks.discardPendingPostMedia).toHaveBeenCalledWith({
      postId: imageUpload.postId,
      storagePath: imageUpload.storagePath,
      mimeType: 'image/jpeg',
    })
    expect(screen.getByLabelText('Poll option 1')).toBeInTheDocument()
    expect(document.querySelector('input[name="mediaPostId"]')).toBeNull()
  })

  it.each([
    [fileWithSize('too-large.jpg', 'image/jpeg', POST_IMAGE_MAX_BYTES + 1), /5 MiB/i],
    [fileWithSize('too-large.mp4', 'video/mp4', POST_VIDEO_MAX_BYTES + 1), /200 MB/i],
  ])('rejects oversized media before requesting an upload target', async (file, message) => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)

    await user.upload(mediaInput(), file)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(mocks.createPostMediaUpload).not.toHaveBeenCalled()
    expect(mocks.uploadPostMediaFile).not.toHaveBeenCalled()
  })

  it('successful publication revokes the local preview without deleting the now-attached object', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.upload(mediaInput(), fileWithSize('portrait.jpg', 'image/jpeg', 1024))
    await screen.findByRole('img', { name: 'Selected post media preview' })
    await user.type(screen.getByPlaceholderText('Share a maritime update, technical lesson, or industry insight...'), 'Safety observation')

    await user.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled())
    await waitFor(() => expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:preview-media'))
    expect(mocks.discardPendingPostMedia).not.toHaveBeenCalled()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('opens poll fields and keeps at least two choices', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.click(screen.getByRole('button', { name: 'Technical Poll' }))
    expect(screen.getByLabelText('Poll option 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Poll option 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add option' })).toBeInTheDocument()
  })
})
