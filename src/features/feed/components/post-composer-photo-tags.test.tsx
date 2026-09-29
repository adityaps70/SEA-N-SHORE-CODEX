import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '@/features/profiles/types'
import type { PhotoTagCandidate } from '../photo-tag-actions'
import { PostComposer } from './post-composer'

const mocks = vi.hoisted(() => ({
  createPost: vi.fn(async () => ({ ok: true })),
  createPostMediaUploads: vi.fn(),
  discardPendingPostMedia: vi.fn(async () => ({ ok: true })),
  uploadPostMediaFile: vi.fn(async () => undefined),
  readPdfPageCount: vi.fn(async () => 3),
  downscaleImage: vi.fn(async (file: File) => file),
  searchPhotoTagCandidates: vi.fn<(query: string) => Promise<{ ok: true; candidates: PhotoTagCandidate[] } | { ok: false; error: string }>>(),
}))

vi.mock('@/lib/images/downscale-image', () => ({ downscaleImage: mocks.downscaleImage }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../actions', () => ({
  createPost: mocks.createPost,
  createPostMediaUploads: mocks.createPostMediaUploads,
  discardPendingPostMedia: mocks.discardPendingPostMedia,
}))
vi.mock('../organization-post-actions', () => ({ loadPostingOrganizations: vi.fn(async () => ({ ok: true, organizations: [] })) }))
vi.mock('../pdf-page-count', () => ({ readPdfPageCount: mocks.readPdfPageCount }))
vi.mock('./upload-post-media', () => ({ uploadPostMediaFile: mocks.uploadPostMediaFile }))
vi.mock('../photo-tag-actions', () => ({ searchPhotoTagCandidates: mocks.searchPhotoTagCandidates }))

const profile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
  location: 'Mumbai',
  headline: 'Chief Officer',
  summary: 'Experienced maritime professional.',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: null,
  sailingExperienceYears: 12,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: [],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
}

const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const rao: PhotoTagCandidate = { id: '22222222-2222-4222-8222-222222222222', slug: 'captain-rao', fullName: 'Captain Rao', avatarUrl: null, detail: 'Master · Blue Fleet', connected: true }
const lee: PhotoTagCandidate = { id: '33333333-3333-4333-8333-333333333333', slug: 'officer-lee', fullName: 'Officer Lee', avatarUrl: null, detail: 'Second Officer', connected: true }
const ali: PhotoTagCandidate = { id: '44444444-4444-4444-8444-444444444444', slug: 'cadet-ali', fullName: 'Cadet Ali', avatarUrl: null, detail: 'Deck cadet', connected: false }

function fileWithSize(name: string, type: string, size: number) {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

function uploadFor(file: File, index: number) {
  const extension = file.type === 'video/mp4' ? 'mp4' : file.type === 'image/png' ? 'png' : 'jpg'
  return {
    postId,
    storagePath: `${profile.id}/${postId}/cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, '0')}.${extension}`,
    mimeType: file.type,
    size: file.size,
    uploadUrl: `https://s3.example/upload-${index + 1}`,
  }
}

async function openComposer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /start a post/i }))
  expect(screen.getByRole('dialog', { name: /create a post/i })).toBeInTheDocument()
}

function manifest() {
  const input = document.querySelector('input[name="mediaManifest"]') as HTMLInputElement | null
  return input ? JSON.parse(input.value) as Array<{ storagePath: string; taggedProfileIds: string[] }> : null
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.createPostMediaUploads.mockImplementation(async ({ files }: { files: Array<{ mimeType: string; size: number; fileName: string }> }) => ({
    ok: true,
    uploads: files.map((entry, index) => uploadFor(fileWithSize(entry.fileName, entry.mimeType, entry.size), index)),
  }))
  mocks.searchPhotoTagCandidates.mockResolvedValue({ ok: true, candidates: [rao, lee, ali] })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((file: File) => `blob:${file.name}`) })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PostComposer: tag people in photos (round 9B)', () => {
  it('tags people per photo, shows them under the tile and sends their ids in the media manifest', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)
    await user.upload(screen.getByLabelText('Photo / Video'), [
      fileWithSize('deck-1.jpg', 'image/jpeg', 1024),
      fileWithSize('deck-2.png', 'image/png', 2048),
    ])
    await waitFor(() => expect(manifest()).toHaveLength(2))
    expect(manifest()?.map((item) => item.taggedProfileIds)).toEqual([[], []])

    expect(screen.getByRole('button', { name: 'Tag people in photo 1' })).toHaveTextContent('Tag people')
    await user.click(screen.getByRole('button', { name: 'Tag people in photo 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Tag people' })
    expect(dialog).toHaveTextContent('Choose who is in photo 1.')
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Tag Captain Rao' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Tag Officer Lee' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Tag Cadet Ali' }))
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))

    expect(screen.queryByRole('dialog', { name: 'Tag people' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /create a post/i })).toBeInTheDocument()
    const summaries = screen.getAllByTestId('composer-photo-tags')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toHaveTextContent('With Captain Rao, Officer Lee +1')
    expect(screen.getByRole('button', { name: 'Tag people in photo 1' })).toHaveTextContent('Tagged (3)')

    expect(manifest()?.map((item) => item.taggedProfileIds)).toEqual([[rao.id, lee.id, ali.id], []])

    // Reopening shows the current selection; removing a chip updates the manifest.
    await user.click(screen.getByRole('button', { name: 'Tag people in photo 1' }))
    const reopened = screen.getByRole('dialog', { name: 'Tag people' })
    await user.click(within(reopened).getByRole('button', { name: 'Remove Officer Lee' }))
    await user.click(within(reopened).getByRole('button', { name: 'Done' }))
    expect(screen.getByTestId('composer-photo-tags')).toHaveTextContent('With Captain Rao, Cadet Ali')
    expect(manifest()?.[0]?.taggedProfileIds).toEqual([rao.id, ali.id])
  })

  it('keeps the composer open when the picker is cancelled and only offers tagging for photos', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await openComposer(user)
    await user.upload(screen.getByLabelText('Photo / Video'), [fileWithSize('deck-1.jpg', 'image/jpeg', 1024)])
    await waitFor(() => expect(manifest()).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Tag people in photo 1' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Tag people' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /create a post/i })).toBeInTheDocument()
    expect(screen.queryByTestId('composer-photo-tags')).not.toBeInTheDocument()

    await user.upload(screen.getByLabelText('Photo / Video'), [fileWithSize('bridge.mp4', 'video/mp4', 4096)])
    await waitFor(() => expect(manifest()?.[0]?.storagePath).toMatch(/\.mp4$/))
    expect(screen.queryByRole('button', { name: /Tag people in photo/ })).not.toBeInTheDocument()
    expect(manifest()?.[0]?.taggedProfileIds).toEqual([])
  })
})
