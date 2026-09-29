import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  uploadAvatarAction: vi.fn<(state: unknown, formData: FormData) => Promise<{ success?: boolean; error?: string }>>(async () => ({})),
  uploadCoverAction: vi.fn<(state: unknown, formData: FormData) => Promise<{ success?: boolean; error?: string }>>(async () => ({})),
  removeAvatarAction: vi.fn(async () => ({ success: true })),
  removeCoverAction: vi.fn(async () => ({ success: true })),
  downscaleImage: vi.fn(async (file: File) => file),
}))

vi.mock('@/lib/images/downscale-image', () => ({
  downscaleImage: mocks.downscaleImage,
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

describe('ProfileMediaControls uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downscaleImage.mockImplementation(async (file: File) => file)
  })

  afterEach(() => cleanup())

  it.each([
    ['avatar', 'Add profile photo', 'uploadAvatarAction'],
    ['cover', 'Add cover', 'uploadCoverAction'],
  ] as const)('shrinks a picked %s photo in the browser and submits it as the form image', async (kind, _label, action) => {
    const original = new File([new Uint8Array(4096)], 'IMG_0001.jpg', { type: 'image/jpeg' })
    const shrunk = new File([new Uint8Array(512)], 'IMG_0001.webp', { type: 'image/webp' })
    mocks.downscaleImage.mockResolvedValueOnce(shrunk)
    mocks[action].mockResolvedValueOnce({ success: true })
    render(<ProfileMediaControls kind={kind} hasImage={false} />)

    const input = document.querySelector('input[type="file"][name="image"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [original] } })

    await waitFor(() => expect(mocks[action]).toHaveBeenCalledTimes(1))
    expect(mocks.downscaleImage).toHaveBeenCalledWith(original, kind)
    const formData = mocks[action].mock.calls[0]?.[1] as FormData
    const submitted = formData.get('image') as File
    expect(submitted).toBeInstanceOf(File)
    expect(submitted.name).toBe('IMG_0001.webp')
    expect(submitted.type).toBe('image/webp')
    expect(submitted.size).toBe(512)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
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
