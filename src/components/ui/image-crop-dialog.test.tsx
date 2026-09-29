import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

const mocks = vi.hoisted(() => ({
  cropImageToFile: vi.fn(),
  cropperProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/images/crop-image', () => ({
  cropImageToFile: mocks.cropImageToFile,
}))

const FIXED_AREA = { x: 10, y: 20, width: 50, height: 50 }
const FIXED_PIXELS = { x: 400, y: 600, width: 2000, height: 2000 }

vi.mock('react-easy-crop', () => ({
  default: function MockCropper(props: Record<string, unknown>) {
    mocks.cropperProps.push(props)
    const complete = props.onCropComplete as (area: typeof FIXED_AREA, pixels: typeof FIXED_PIXELS) => void
    const cropperProps = (props.cropperProps ?? {}) as Record<string, unknown>
    // The real cropper reports the initial crop box as soon as the photo has loaded.
    useEffect(() => {
      complete(FIXED_AREA, FIXED_PIXELS)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once, like the media load event
    }, [])
    return (
      <div data-testid="mock-cropper" data-shape={String(props.cropShape)} data-aspect={String(props.aspect)} data-zoom={String(props.zoom)}>
        <div data-testid="cropper" {...cropperProps} />
        <button type="button" onClick={() => complete({ x: 0, y: 0, width: 100, height: 25 }, { x: 0, y: 0, width: 4000, height: 1000 })}>complete</button>
      </div>
    )
  },
}))

import { CROP_AREA_LABEL, ImageCropDialog, cropPreviewStyle } from './image-crop-dialog'

const photo = new File([new Uint8Array(64)], 'IMG_0001.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cropperProps = []
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:https://seanshore.example/photo'),
    revokeObjectURL: vi.fn(),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ImageCropDialog', () => {
  it('opens as a labelled modal with the cropper, a zoom slider and a keyboard-operable crop area', () => {
    const onCancel = vi.fn()
    render(<ImageCropDialog file={photo} shape="circle" aspect={1} title="Adjust your profile photo" onCancel={onCancel} onSave={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'Adjust your profile photo' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveValue('1')
    expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-shape', 'round')
    expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-aspect', '1')
    expect(mocks.cropperProps[0]?.showGrid).toBe(false)
    expect(screen.getByLabelText(CROP_AREA_LABEL)).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('bg-navy-950', 'text-white', 'hover:bg-ocean-700')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Zoom' })).toHaveFocus()
  })

  it('uses a rectangular crop box for covers and shows a preview at that aspect', () => {
    render(<ImageCropDialog file={photo} shape="rect" aspect={4} title="Adjust your cover photo" onCancel={vi.fn()} onSave={vi.fn()} />)

    expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-shape', 'rect')
    expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-aspect', '4')
    const preview = screen.getByTestId('crop-preview')
    expect(preview).toHaveClass('h-10', 'w-40')
    expect(preview.style.backgroundImage).toContain('blob:https://seanshore.example/photo')
  })

  it('moves the zoom slider and hands the value to the cropper', () => {
    render(<ImageCropDialog file={photo} shape="circle" aspect={1} title="Adjust your profile photo" onCancel={vi.fn()} onSave={vi.fn()} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2.5' } })

    expect(screen.getByTestId('mock-cropper')).toHaveAttribute('data-zoom', '2.5')
  })

  it('updates the live preview from the crop box', () => {
    render(<ImageCropDialog file={photo} shape="circle" aspect={1} title="Adjust your profile photo" onCancel={vi.fn()} onSave={vi.fn()} />)

    const preview = screen.getByTestId('crop-preview')
    expect(preview).toHaveClass('size-12', 'rounded-full')
    expect(preview.style.backgroundSize).toBe('200% 200%')
    expect(preview.style.backgroundPosition).toBe('20% 40%')

    fireEvent.click(screen.getByRole('button', { name: 'complete' }))

    expect(preview.style.backgroundSize).toBe('100% 400%')
    expect(preview.style.backgroundPosition).toBe('0% 0%')
  })

  it('cancels from the Cancel button, the backdrop and Escape', () => {
    const onCancel = vi.fn()
    const { unmount } = render(<ImageCropDialog file={photo} shape="circle" aspect={1} title="Adjust your profile photo" onCancel={onCancel} onSave={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('dialog').previousElementSibling as Element)
    expect(onCancel).toHaveBeenCalledTimes(3)
    unmount()
  })

  it('returns focus to the button that opened it when it closes', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Add profile photo'
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = render(<ImageCropDialog file={photo} shape="circle" aspect={1} title="Adjust your profile photo" onCancel={vi.fn()} onSave={vi.fn()} />)
    expect(trigger).not.toHaveFocus()
    unmount()

    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('crops the framed pixels on Save and hands back the new file', async () => {
    const cropped = new File([new Uint8Array(32)], 'IMG_0001.webp', { type: 'image/webp' })
    mocks.cropImageToFile.mockResolvedValueOnce(cropped)
    const onSave = vi.fn()
    render(<ImageCropDialog file={photo} shape="circle" aspect={1} title="Adjust your profile photo" onCancel={vi.fn()} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(cropped))
    expect(mocks.cropImageToFile).toHaveBeenCalledWith(photo, FIXED_PIXELS, { maxEdge: 1024 })
  })

  it('allows a larger result for rectangular crops', async () => {
    mocks.cropImageToFile.mockResolvedValueOnce(new File([new Uint8Array(32)], 'banner.webp', { type: 'image/webp' }))
    render(<ImageCropDialog file={photo} shape="rect" aspect={4} title="Adjust your cover photo" onCancel={vi.fn()} onSave={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.cropImageToFile).toHaveBeenCalledWith(photo, FIXED_PIXELS, { maxEdge: 2048 }))
  })

  it('uploads the photo as picked when the browser cannot crop it', async () => {
    mocks.cropImageToFile.mockResolvedValueOnce(null)
    const onSave = vi.fn()
    render(<ImageCropDialog file={photo} shape="circle" aspect={1} title="Adjust your profile photo" onCancel={vi.fn()} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(photo))
  })

  it('reports a failed crop and keeps the dialog open', async () => {
    mocks.cropImageToFile.mockRejectedValueOnce(new Error('boom'))
    const onSave = vi.fn()
    render(<ImageCropDialog file={photo} shape="circle" aspect={1} title="Adjust your profile photo" onCancel={vi.fn()} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to crop this photo')
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})

describe('cropPreviewStyle', () => {
  it('shows the whole photo before the crop box is known', () => {
    expect(cropPreviewStyle('blob:x', null)).toMatchObject({ backgroundSize: 'cover', backgroundPosition: '50% 50%' })
  })

  it('scales and positions the photo so only the crop box is visible', () => {
    expect(cropPreviewStyle('blob:x', { x: 25, y: 0, width: 50, height: 100 })).toMatchObject({
      backgroundImage: 'url("blob:x")',
      backgroundSize: '200% 100%',
      backgroundPosition: '50% 0%',
    })
  })
})
