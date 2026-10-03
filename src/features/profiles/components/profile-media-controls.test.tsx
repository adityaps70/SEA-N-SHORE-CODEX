import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  cropImageToFile: vi.fn(),
  uploadAvatarAction: vi.fn<(state: unknown, formData: FormData) => Promise<{ success?: boolean; error?: string }>>(async () => ({})),
  uploadCoverAction: vi.fn<(state: unknown, formData: FormData) => Promise<{ success?: boolean; error?: string }>>(async () => ({})),
  removeAvatarAction: vi.fn(async () => ({ success: true })),
  removeCoverAction: vi.fn(async () => ({ success: true })),
  downscaleImage: vi.fn(async (file: File) => file),
}))

vi.mock('@/lib/images/downscale-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/images/downscale-image')>()),
  downscaleImage: mocks.downscaleImage,
}))

vi.mock('@/lib/images/crop-image', () => ({
  cropImageToFile: mocks.cropImageToFile,
}))

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('../profile-media-actions', () => ({
  uploadAvatarAction: mocks.uploadAvatarAction,
  uploadCoverAction: mocks.uploadCoverAction,
  removeAvatarAction: mocks.removeAvatarAction,
  removeCoverAction: mocks.removeCoverAction,
}))

import { ProfileMediaControls } from './profile-media-controls'

function pickFile(file: File) {
  const input = document.querySelector('input[type="file"][name="image"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  return input
}

describe('ProfileMediaControls uploads', () => {
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

  it.each([
    ['avatar', 'Adjust your profile photo', 'round', '1', 1024, 'uploadAvatarAction'],
    ['cover', 'Adjust your cover photo', 'rect', '4', 2048, 'uploadCoverAction'],
  ] as const)('lets the member frame a picked %s photo, then shrinks the crop and submits it as the form image', async (kind, title, shape, aspect, maxEdge, action) => {
    const original = new File([new Uint8Array(4096)], 'IMG_0001.jpg', { type: 'image/jpeg' })
    const cropped = new File([new Uint8Array(1024)], 'IMG_0001.webp', { type: 'image/webp' })
    const shrunk = new File([new Uint8Array(512)], 'IMG_0001.webp', { type: 'image/webp' })
    mocks.cropImageToFile.mockResolvedValueOnce(cropped)
    mocks.downscaleImage.mockResolvedValueOnce(shrunk)
    mocks[action].mockResolvedValueOnce({ success: true })
    render(<ProfileMediaControls kind={kind} hasImage={false} />)

    pickFile(original)

    const dialog = screen.getByRole('dialog', { name: title })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-shape', shape)
    expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-aspect', aspect)
    expect(screen.getByRole('slider', { name: 'Zoom' })).toBeInTheDocument()
    expect(mocks[action]).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks[action]).toHaveBeenCalledTimes(1))
    expect(mocks.cropImageToFile).toHaveBeenCalledWith(original, PIXEL_CROP, { maxEdge })
    expect(mocks.downscaleImage).toHaveBeenCalledWith(cropped, kind)
    const formData = mocks[action].mock.calls[0]?.[1] as FormData
    const submitted = formData.get('image') as File
    expect(submitted).toBeInstanceOf(File)
    expect(submitted.name).toBe('IMG_0001.webp')
    expect(submitted.type).toBe('image/webp')
    expect(submitted.size).toBe(512)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it('uploads nothing and clears the picker when the member cancels the crop', async () => {
    const original = new File([new Uint8Array(4096)], 'IMG_0001.jpg', { type: 'image/jpeg' })
    render(<ProfileMediaControls kind="avatar" hasImage={false} />)

    const input = pickFile(original)
    expect(screen.getByRole('dialog', { name: 'Adjust your profile photo' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(input.value).toBe('')
    expect(mocks.uploadAvatarAction).not.toHaveBeenCalled()
    expect(mocks.cropImageToFile).not.toHaveBeenCalled()
    expect(mocks.downscaleImage).not.toHaveBeenCalled()
  })

  it('closes the crop dialog with Escape without uploading', () => {
    render(<ProfileMediaControls kind="cover" hasImage={false} />)
    pickFile(new File([new Uint8Array(4096)], 'banner.png', { type: 'image/png' }))
    expect(screen.getByRole('dialog', { name: 'Adjust your cover photo' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.uploadCoverAction).not.toHaveBeenCalled()
  })

  it('uploads a GIF as it is, without the crop dialog', async () => {
    const gif = new File([new Uint8Array(4096)], 'wave.gif', { type: 'image/gif' })
    mocks.uploadAvatarAction.mockResolvedValueOnce({ success: true })
    render(<ProfileMediaControls kind="avatar" hasImage={false} />)

    pickFile(gif)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.uploadAvatarAction).toHaveBeenCalledTimes(1))
    expect(mocks.cropImageToFile).not.toHaveBeenCalled()
    expect(mocks.downscaleImage).toHaveBeenCalledWith(gif, 'avatar')
    const formData = mocks.uploadAvatarAction.mock.calls[0]?.[1] as FormData
    expect((formData.get('image') as File).name).toBe('wave.gif')
  })
})

describe('ProfileMediaControls hydration safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the profile-photo trigger disabled in server HTML until client hydration can handle clicks', () => {
    const markup = renderToStaticMarkup(<ProfileMediaControls kind="avatar" hasImage={false} />)
    const host = document.createElement('div')
    host.innerHTML = markup

    const serverButton = host.querySelector('button[aria-label="Add profile photo"]')
    expect(serverButton).not.toBeNull()
    expect(serverButton).toBeDisabled()

    render(<ProfileMediaControls kind="avatar" hasImage={false} />)
    expect(screen.getByRole('button', { name: 'Add profile photo' })).toBeEnabled()
  })
})
