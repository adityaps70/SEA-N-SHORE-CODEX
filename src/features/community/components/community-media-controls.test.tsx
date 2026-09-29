import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  cropImageToFile: vi.fn(),
  uploadCommunityIconAction: vi.fn<(state: unknown, formData: FormData) => Promise<{ success?: boolean; error?: string }>>(async () => ({})),
  uploadCommunityCoverAction: vi.fn<(state: unknown, formData: FormData) => Promise<{ success?: boolean; error?: string }>>(async () => ({})),
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

// The cropper itself is canvas and pointer driven; here it reports one fixed crop box on load.
vi.mock('react-easy-crop', () => ({
  default: function MockCropper(props: { onCropComplete: (area: unknown, pixels: unknown) => void; cropShape: string; aspect: number }) {
    const { onCropComplete } = props
    useEffect(() => {
      onCropComplete({ x: 10, y: 10, width: 50, height: 50 }, PIXEL_CROP)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once, like the media load event
    }, [])
    return <div data-testid="mock-cropper" data-shape={props.cropShape} data-aspect={String(props.aspect)} />
  },
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

vi.mock('../media-actions', () => ({
  uploadCommunityIconAction: mocks.uploadCommunityIconAction,
  uploadCommunityCoverAction: mocks.uploadCommunityCoverAction,
  removeCommunityIconAction: mocks.removeCommunityIconAction,
  removeCommunityCoverAction: mocks.removeCommunityCoverAction,
}))

import { CommunityMediaControls } from './community-media-controls'

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

  it.each([
    ['icon', 'community photo', 'Crop community photo', 'rect', '1', 'avatar', 'uploadCommunityIconAction'],
    ['cover', 'community banner', 'Crop community banner', 'rect', '4', 'cover', 'uploadCommunityCoverAction'],
  ] as const)('crops a picked %s PNG as a rounded square / banner, shrinks it and submits it with the group id', async (kind, label, title, shape, aspect, downscaleKind, action) => {
    const original = new File([new Uint8Array(4096)], 'IMG_0001.png', { type: 'image/png' })
    const cropped = new File([new Uint8Array(1024)], 'IMG_0001.webp', { type: 'image/webp' })
    const shrunk = new File([new Uint8Array(512)], 'IMG_0001.webp', { type: 'image/webp' })
    mocks.cropImageToFile.mockResolvedValueOnce(cropped)
    mocks.downscaleImage.mockResolvedValueOnce(shrunk)
    mocks[action].mockResolvedValueOnce({ success: true })
    render(<CommunityMediaControls groupId={groupId} kind={kind} hasImage={false} canManage />)

    const trigger = screen.getByRole('button', { name: `Add ${label}` })
    expect(trigger).toHaveClass('rounded-full', 'size-10', 'md:size-9')
    expect(screen.queryByRole('button', { name: `Remove ${label}` })).not.toBeInTheDocument()

    pickFile(original)

    const dialog = screen.getByRole('dialog', { name: title })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-shape', shape)
    expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-aspect', aspect)
    expect(mocks[action]).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks[action]).toHaveBeenCalledTimes(1))
    expect(mocks.cropImageToFile).toHaveBeenCalledWith(original, PIXEL_CROP, { maxEdge: 2048 })
    expect(mocks.downscaleImage).toHaveBeenCalledWith(cropped, downscaleKind)
    const formData = mocks[action].mock.calls[0]?.[1] as FormData
    expect(formData.get('groupId')).toBe(groupId)
    const submitted = formData.get('image') as File
    expect(submitted).toBeInstanceOf(File)
    expect(submitted.type).toBe('image/webp')
    expect(submitted.size).toBe(512)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    // After a successful upload the remove option appears.
    expect(screen.getByRole('button', { name: `Remove ${label}` })).toBeInTheDocument()
  })

  it('uploads nothing and clears the picker when the crop is cancelled', () => {
    render(<CommunityMediaControls groupId={groupId} kind="icon" hasImage={false} canManage />)
    const input = pickFile(new File([new Uint8Array(4096)], 'IMG_0001.png', { type: 'image/png' }))
    expect(screen.getByRole('dialog', { name: 'Crop community photo' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(input.value).toBe('')
    expect(mocks.uploadCommunityIconAction).not.toHaveBeenCalled()
    expect(mocks.downscaleImage).not.toHaveBeenCalled()
  })

  it('removes the current image through the remove action with the group id', async () => {
    render(<CommunityMediaControls groupId={groupId} kind="cover" hasImage canManage />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove community banner' }))

    await waitFor(() => expect(mocks.removeCommunityCoverAction).toHaveBeenCalledTimes(1))
    expect((mocks.removeCommunityCoverAction.mock.calls[0]?.[0] as FormData).get('groupId')).toBe(groupId)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Remove community banner' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add community banner' })).toBeInTheDocument()
  })

  it('shows the action error when removal is refused', async () => {
    mocks.removeCommunityIconAction.mockResolvedValueOnce({ error: 'Only the owner and moderators of this group can change its images.' })
    render(<CommunityMediaControls groupId={groupId} kind="icon" hasImage canManage />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove community photo' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Only the owner and moderators of this group can change its images.'))
    expect(screen.getByRole('button', { name: 'Remove community photo' })).toBeInTheDocument()
  })
})
