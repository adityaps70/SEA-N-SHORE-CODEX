import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  cropImageToFile: vi.fn(),
  requestCommunityMediaUploadAction: vi.fn(),
  completeCommunityMediaUploadAction: vi.fn(),
  removeCommunityIconAction: vi.fn<(formData: FormData) => Promise<{ success?: boolean; error?: string }>>(async () => ({ success: true })),
  removeCommunityCoverAction: vi.fn<(formData: FormData) => Promise<{ success?: boolean; error?: string }>>(async () => ({ success: true })),
  downscaleImage: vi.fn(async (file: File) => file),
}))

vi.mock('@/lib/images/downscale-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/images/downscale-image')>()),
  downscaleImage: mocks.downscaleImage,
}))
vi.mock('@/lib/images/crop-image', () => ({ cropImageToFile: mocks.cropImageToFile }))

const PIXEL_CROP = { x: 100, y: 50, width: 800, height: 800 }

vi.mock('react-easy-crop', () => ({
  default: function MockCropper(props: { onCropComplete: (area: unknown, pixels: unknown) => void; cropShape: string; aspect: number }) {
    const { onCropComplete } = props
    useEffect(() => {
      onCropComplete({ x: 10, y: 10, width: 50, height: 50 }, PIXEL_CROP)
    }, [onCropComplete])
    return <div data-testid="mock-cropper" data-shape={props.cropShape} data-aspect={String(props.aspect)} />
  },
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

vi.mock('../media-actions', () => ({
  requestCommunityMediaUploadAction: mocks.requestCommunityMediaUploadAction,
  completeCommunityMediaUploadAction: mocks.completeCommunityMediaUploadAction,
  removeCommunityIconAction: mocks.removeCommunityIconAction,
  removeCommunityCoverAction: mocks.removeCommunityCoverAction,
}))

import { CommunityIconEditor, CommunityMediaControls } from './community-media-controls'

const groupId = '22222222-2222-4222-8222-222222222222'

function pickFile(file: File) {
  const input = document.querySelector('input[type="file"][name="image"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  return input
}

describe('CommunityMediaControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downscaleImage.mockImplementation(async (file: File) => file)
    mocks.requestCommunityMediaUploadAction.mockResolvedValue({
      success: true,
      uploadUrl: 'https://s3.example/presigned',
      key: `communities/${groupId}/cover-123.webp`,
    })
    mocks.completeCommunityMediaUploadAction.mockResolvedValue({ success: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:https://seanshore.example/photo'),
      revokeObjectURL: vi.fn(),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders nothing for members who cannot manage the group', () => {
    const { container } = render(<CommunityMediaControls groupId={groupId} kind="icon" hasImage canManage={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('crops, shrinks and PUTs a banner directly to S3 before finalizing metadata', async () => {
    const original = new File([new Uint8Array(4096)], 'IMG_0001.png', { type: 'image/png' })
    const cropped = new File([new Uint8Array(1024)], 'IMG_0001.webp', { type: 'image/webp' })
    const shrunk = new File([new Uint8Array(512)], 'IMG_0001.webp', { type: 'image/webp' })
    mocks.cropImageToFile.mockResolvedValueOnce(cropped)
    mocks.downscaleImage.mockResolvedValueOnce(shrunk)

    render(<CommunityMediaControls groupId={groupId} kind="cover" hasImage={false} canManage />)
    pickFile(original)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.requestCommunityMediaUploadAction).toHaveBeenCalledWith({
      groupId,
      kind: 'cover',
      contentType: 'image/webp',
      size: 512,
    }))
    expect(fetch).toHaveBeenCalledWith('https://s3.example/presigned', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/webp' },
      body: shrunk,
    })
    await waitFor(() => expect(mocks.completeCommunityMediaUploadAction).toHaveBeenCalledWith({
      groupId,
      kind: 'cover',
      key: `communities/${groupId}/cover-123.webp`,
    }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The action revalidates the community pages, so no extra router.refresh() (redundant-router-refresh contract).
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('keeps the crop dialog open and shows Upload failed, try again when S3 PUT fails', async () => {
    mocks.cropImageToFile.mockResolvedValueOnce(new File([new Uint8Array(32)], 'banner.webp', { type: 'image/webp' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })))

    render(<CommunityMediaControls groupId={groupId} kind="cover" hasImage={false} canManage />)
    pickFile(new File([new Uint8Array(4096)], 'banner.png', { type: 'image/png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed, try again')
    expect(screen.getByRole('dialog', { name: 'Crop community banner' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(mocks.completeCommunityMediaUploadAction).not.toHaveBeenCalled()
  })

  it('removes the current image through the remove action with the group id', async () => {
    render(<CommunityMediaControls groupId={groupId} kind="cover" hasImage canManage />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove community banner' }))

    await waitFor(() => expect(mocks.removeCommunityCoverAction).toHaveBeenCalledTimes(1))
    expect((mocks.removeCommunityCoverAction.mock.calls[0]?.[0] as FormData).get('groupId')).toBe(groupId)
    // The action revalidates the community pages, so no extra router.refresh() (redundant-router-refresh contract).
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  describe('CommunityIconEditor (round H, H6)', () => {
    const tile = <span data-testid="tile">Logo text</span>

    it('shows only the photo to members who cannot manage the community', () => {
      render(<CommunityIconEditor groupId={groupId} hasImage canManage={false}>{tile}</CommunityIconEditor>)
      expect(screen.getByTestId('tile')).toBeInTheDocument()
      expect(screen.queryByTestId('community-icon-editor')).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('puts Change and Remove in an overlay that appears on hover or keyboard focus, not over the photo at rest', () => {
      render(<CommunityIconEditor groupId={groupId} hasImage canManage>{tile}</CommunityIconEditor>)
      const overlay = screen.getByRole('group', { name: 'Edit community photo' })
      expect(overlay).toContainElement(screen.getByRole('button', { name: 'Change community photo' }))
      expect(overlay).toContainElement(screen.getByRole('button', { name: 'Remove community photo' }))
      // Hidden and click-through at rest, shown with hover and with focus inside the editor.
      expect(overlay).toHaveClass('opacity-0', 'pointer-events-none')
      expect(overlay).toHaveClass('group-hover/icon:opacity-100', 'group-focus-within/icon:opacity-100', 'group-focus-within/icon:pointer-events-auto')
      expect(screen.getByTestId('community-icon-editor')).toHaveClass('group/icon')
      expect(screen.getByTestId('community-icon-editor')).toContainElement(screen.getByTestId('tile'))
      // The buttons stay in the tab order so keyboard focus can reveal them.
      expect(screen.getByRole('button', { name: 'Change community photo' })).not.toHaveAttribute('tabindex', '-1')
    })

    it('offers an always-visible Edit button on phones and touch screens that opens and closes the overlay', () => {
      render(<CommunityIconEditor groupId={groupId} hasImage={false} canManage>{tile}</CommunityIconEditor>)
      const edit = screen.getByRole('button', { name: 'Edit community photo' })
      expect(edit).toHaveClass('hidden', 'max-md:inline-flex', 'pointer-coarse:inline-flex')
      expect(edit).toHaveAttribute('aria-expanded', 'false')
      const overlay = screen.getByRole('group', { name: 'Edit community photo' })
      expect(overlay).toHaveAttribute('data-open', 'false')

      fireEvent.click(edit)
      expect(edit).toHaveAttribute('aria-expanded', 'true')
      expect(overlay).toHaveAttribute('data-open', 'true')
      expect(overlay).toHaveClass('opacity-100', 'pointer-events-auto')
      // No photo yet: Add, and no Remove.
      expect(screen.getByRole('button', { name: 'Add community photo' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove community photo' })).not.toBeInTheDocument()

      fireEvent.keyDown(screen.getByRole('button', { name: 'Add community photo' }), { key: 'Escape' })
      expect(edit).toHaveAttribute('aria-expanded', 'false')
      expect(overlay).toHaveAttribute('data-open', 'false')
    })

    it('removes the photo through the same server action', async () => {
      render(<CommunityIconEditor groupId={groupId} hasImage canManage>{tile}</CommunityIconEditor>)
      fireEvent.click(screen.getByRole('button', { name: 'Remove community photo' }))
      await waitFor(() => expect(mocks.removeCommunityIconAction).toHaveBeenCalledTimes(1))
      expect((mocks.removeCommunityIconAction.mock.calls[0]?.[0] as FormData).get('groupId')).toBe(groupId)
    })
  })
})
