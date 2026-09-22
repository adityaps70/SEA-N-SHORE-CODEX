import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '@/features/profiles/types'
import {
  POST_DOCUMENT_MAX_BYTES,
  POST_IMAGE_MAX_BYTES,
  POST_IMAGE_MAX_COUNT,
  POST_VIDEO_MAX_BYTES,
} from '../media-policy'
import { PostComposer } from './post-composer'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  createPost: vi.fn(async () => ({ ok: true })),
  createPostMediaUploads: vi.fn(),
  discardPendingPostMedia: vi.fn(async () => ({ ok: true })),
  uploadPostMediaFile: vi.fn<(input: { uploadUrl: string; file: File; onProgress: (percent: number) => void }) => Promise<void>>(),
  readPdfPageCount: vi.fn(async () => 12),
  createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
  revokeObjectURL: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('../actions', () => ({
  createPost: mocks.createPost,
  createPostMediaUploads: mocks.createPostMediaUploads,
  discardPendingPostMedia: mocks.discardPendingPostMedia,
}))

vi.mock('../pdf-page-count', () => ({
  readPdfPageCount: mocks.readPdfPageCount,
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

const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function uploadFor(file: File, index: number) {
  const extension = file.type === 'application/pdf' ? 'pdf'
    : file.type === 'video/mp4' ? 'mp4'
      : file.type === 'video/webm' ? 'webm'
        : file.type === 'image/png' ? 'png'
          : file.type === 'image/webp' ? 'webp'
            : 'jpg'
  return {
    postId,
    storagePath: `${profile.id}/${postId}/cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, '0')}.${extension}`,
    mimeType: file.type,
    size: file.size,
    uploadUrl: `https://s3.example/upload-${index + 1}`,
  }
}

function photoVideoInput() {
  return screen.getByLabelText('Photo / Video') as HTMLInputElement
}

function documentInput() {
  return screen.getByLabelText('Document') as HTMLInputElement
}

async function openComposer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /start a post/i }))
  expect(screen.getByRole('dialog', { name: /create a post/i })).toBeInTheDocument()
}

function fileWithSize(name: string, type: string, size: number) {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.createPost.mockResolvedValue({ ok: true })
  mocks.createPostMediaUploads.mockImplementation(async ({ files }: { files: Array<{ mimeType: string; size: number; fileName: string }> }) => {
    const source = files.map((entry) => fileWithSize(entry.fileName, entry.mimeType, entry.size))
    return { ok: true, uploads: source.map(uploadFor) }
  })
  mocks.discardPendingPostMedia.mockResolvedValue({ ok: true })
  mocks.uploadPostMediaFile.mockResolvedValue(undefined)
  mocks.readPdfPageCount.mockResolvedValue(12)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: mocks.createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: mocks.revokeObjectURL })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PostComposer rich media', () => {
  it('keeps the Sea N Shore composer UI while exposing multi-photo/video and PDF controls', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)

    expect(screen.getByText('Photo / Video')).toBeInTheDocument()
    expect(screen.getByText('Document')).toBeInTheDocument()
    expect(photoVideoInput()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,video/mp4,video/webm')
    expect(photoVideoInput()).toHaveAttribute('multiple')
    expect(documentInput()).toHaveAttribute('accept', 'application/pdf')
    expect(documentInput()).not.toHaveAttribute('multiple')
    expect(screen.getByText('Up to 10 photos')).toBeInTheDocument()
    expect(screen.getByText('PDF · Max 25 MB · 50 pages')).toBeInTheDocument()
  })

  it('uploads multiple photos under one post id and serializes an ordered manifest', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)
    const first = fileWithSize('deck-1.jpg', 'image/jpeg', 1024)
    const second = fileWithSize('deck-2.png', 'image/png', 2048)

    await user.upload(photoVideoInput(), [first, second])

    await waitFor(() => expect(mocks.createPostMediaUploads).toHaveBeenCalledWith({
      files: [
        { mimeType: 'image/jpeg', size: 1024, fileName: 'deck-1.jpg', pageCount: null },
        { mimeType: 'image/png', size: 2048, fileName: 'deck-2.png', pageCount: null },
      ],
    }))
    await waitFor(() => expect(mocks.uploadPostMediaFile).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('img', { name: 'Selected photo 1 preview' })).toHaveAttribute('src', 'blob:deck-1.jpg')
    expect(screen.getByRole('img', { name: 'Selected photo 2 preview' })).toHaveAttribute('src', 'blob:deck-2.png')

    const manifest = document.querySelector('input[name="mediaManifest"]') as HTMLInputElement
    expect(manifest).not.toBeNull()
    expect(JSON.parse(manifest.value)).toEqual([
      expect.objectContaining({ postId, mimeType: 'image/jpeg', fileName: 'deck-1.jpg', position: 0, pageCount: null }),
      expect.objectContaining({ postId, mimeType: 'image/png', fileName: 'deck-2.png', position: 1, pageCount: null }),
    ])
  })

  it('keeps one video as a controls-enabled preview', async () => {
    const user = userEvent.setup()
    const { container } = render(<PostComposer profile={profile} />)
    await openComposer(user)
    const video = fileWithSize('bridge.mp4', 'video/mp4', 2048)

    await user.upload(photoVideoInput(), video)

    await waitFor(() => expect(mocks.uploadPostMediaFile).toHaveBeenCalledTimes(1))
    const preview = container.querySelector('video')
    expect(preview).not.toBeNull()
    expect(preview).toHaveAttribute('controls')
    expect(preview).toHaveAttribute('src', 'blob:bridge.mp4')
  })

  it('reads PDF pages before upload and prepares a document carousel manifest', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)
    const pdf = fileWithSize('SIRE-2-guide.pdf', 'application/pdf', 5 * 1024 * 1024)

    await user.upload(documentInput(), pdf)

    await waitFor(() => expect(mocks.readPdfPageCount).toHaveBeenCalledWith(pdf))
    await waitFor(() => expect(mocks.createPostMediaUploads).toHaveBeenCalledWith({
      files: [{
        mimeType: 'application/pdf',
        size: 5 * 1024 * 1024,
        fileName: 'SIRE-2-guide.pdf',
        pageCount: 12,
      }],
    }))
    expect(await screen.findByText('SIRE-2-guide.pdf')).toBeInTheDocument()
    expect(screen.getByText('12 pages · Ready to post')).toBeInTheDocument()

    const manifest = document.querySelector('input[name="mediaManifest"]') as HTMLInputElement
    expect(JSON.parse(manifest.value)[0]).toEqual(expect.objectContaining({
      postId,
      mimeType: 'application/pdf',
      fileName: 'SIRE-2-guide.pdf',
      pageCount: 12,
      position: 0,
    }))
  })

  it('rejects more than the 10-photo Sea N Shore limit before requesting upload URLs', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)
    const photos = Array.from({ length: POST_IMAGE_MAX_COUNT + 1 }, (_, index) => (
      fileWithSize(`photo-${index + 1}.jpg`, 'image/jpeg', 1024)
    ))

    await user.upload(photoVideoInput(), photos)

    expect(await screen.findByText('Add no more than 10 photos to one post.')).toBeInTheDocument()
    expect(mocks.createPostMediaUploads).not.toHaveBeenCalled()
  })

  it.each([
    [fileWithSize('too-large.jpg', 'image/jpeg', POST_IMAGE_MAX_BYTES + 1), photoVideoInput, /5 MiB/i],
    [fileWithSize('too-large.mp4', 'video/mp4', POST_VIDEO_MAX_BYTES + 1), photoVideoInput, /200 MB/i],
    [fileWithSize('too-large.pdf', 'application/pdf', POST_DOCUMENT_MAX_BYTES + 1), documentInput, /25 MB/i],
  ])('rejects oversized media before requesting an upload target', async (file, input, message) => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)

    await user.upload(input(), file)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(mocks.createPostMediaUploads).not.toHaveBeenCalled()
  })

  it('rejects PDFs over 50 pages before upload', async () => {
    mocks.readPdfPageCount.mockResolvedValueOnce(51)
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)

    await user.upload(documentInput(), fileWithSize('manual.pdf', 'application/pdf', 1024))

    expect(await screen.findByText('PDF documents can have no more than 50 pages.')).toBeInTheDocument()
    expect(mocks.createPostMediaUploads).not.toHaveBeenCalled()
  })

  it('rejects mixed video/photo batches and keeps multi-select photo-only', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)

    await user.upload(photoVideoInput(), [
      fileWithSize('deck.jpg', 'image/jpeg', 1024),
      fileWithSize('bridge.mp4', 'video/mp4', 2048),
    ])

    expect(await screen.findByText('Choose up to 10 photos, or attach one video or one PDF document.')).toBeInTheDocument()
    expect(mocks.createPostMediaUploads).not.toHaveBeenCalled()
  })

  it('keeps Post disabled and withholds the manifest while any upload is unresolved', async () => {
    let finishUpload: (() => void) | undefined
    mocks.uploadPostMediaFile.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishUpload = resolve
    }))
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)

    await user.upload(photoVideoInput(), fileWithSize('portrait.webp', 'image/webp', 1024))

    await waitFor(() => expect(mocks.uploadPostMediaFile).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Post Update' })).toBeDisabled()
    expect(screen.getByText(/Uploading/i)).toBeInTheDocument()
    expect(document.querySelector('input[name="mediaManifest"]')).toBeNull()

    finishUpload?.()
    await waitFor(() => expect(document.querySelector('input[name="mediaManifest"]')).not.toBeNull())
  })

  it('can remove one photo without clearing the rest of the gallery', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)
    const first = fileWithSize('deck-1.jpg', 'image/jpeg', 1024)
    const second = fileWithSize('deck-2.jpg', 'image/jpeg', 1024)

    await user.upload(photoVideoInput(), [first, second])
    await screen.findByRole('img', { name: 'Selected photo 2 preview' })
    await user.click(screen.getByRole('button', { name: 'Remove deck-1.jpg' }))

    expect(mocks.discardPendingPostMedia).toHaveBeenCalledWith(expect.objectContaining({
      postId,
      mimeType: 'image/jpeg',
    }))
    expect(screen.queryByRole('img', { name: 'Selected photo 2 preview' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Selected photo 1 preview' })).toHaveAttribute('src', 'blob:deck-2.jpg')
    const manifest = document.querySelector('input[name="mediaManifest"]') as HTMLInputElement
    expect(JSON.parse(manifest.value)).toEqual([
      expect.objectContaining({ fileName: 'deck-2.jpg', position: 0 }),
    ])
  })

  it('switching to Poll discards every pending media object', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)
    await user.upload(photoVideoInput(), [
      fileWithSize('deck-1.jpg', 'image/jpeg', 1024),
      fileWithSize('deck-2.jpg', 'image/jpeg', 1024),
    ])
    await screen.findByRole('img', { name: 'Selected photo 2 preview' })

    await user.click(screen.getByRole('button', { name: 'Poll' }))

    expect(mocks.discardPendingPostMedia).toHaveBeenCalledTimes(2)
    expect(document.querySelector('input[name="mediaManifest"]')).toBeNull()
    expect(screen.getByLabelText('Poll option 1')).toBeInTheDocument()
  })

  it('successful publication revokes previews without deleting now-attached objects', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)
    await user.upload(photoVideoInput(), [
      fileWithSize('deck-1.jpg', 'image/jpeg', 1024),
      fileWithSize('deck-2.jpg', 'image/jpeg', 1024),
    ])
    await screen.findByRole('img', { name: 'Selected photo 2 preview' })
    await user.type(screen.getByPlaceholderText('Share an update, insight or lesson with the maritime community…'), 'Safety observation')

    await user.click(screen.getByRole('button', { name: 'Post Update' }))

    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled())
    await waitFor(() => expect(mocks.revokeObjectURL).toHaveBeenCalledTimes(2))
    expect(mocks.discardPendingPostMedia).not.toHaveBeenCalled()
    expect(mocks.refresh).toHaveBeenCalled()
  })
})
