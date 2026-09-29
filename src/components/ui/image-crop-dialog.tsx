'use client'

import Cropper, { type Area } from 'react-easy-crop'
import { useCallback, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalLayer } from '@/features/messaging/components/use-modal-layer'
import { cropImageToFile, type PixelCrop } from '@/lib/images/crop-image'

export type ImageCropShape = 'circle' | 'rect'

export type ImageCropDialogProps = {
  /** The photo the member just picked. */
  file: File
  /** `circle` for profile photos (round mask, square output); `rect` for covers and logos. */
  shape: ImageCropShape
  /** Width ÷ height of the crop box, e.g. 1 for a square, 4 for a 4:1 banner. */
  aspect: number
  title: string
  onCancel(): void
  /** Receives the cropped photo (WebP, JPEG where WebP cannot be encoded), named like the original. */
  onSave(file: File): void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 3

/** Long edge of the cropped result; the per-use `downscaleImage` runs after and may shrink it further. */
export const CROP_MAX_EDGE_PX: Record<ImageCropShape, number> = { circle: 1024, rect: 2048 }

export const CROP_AREA_LABEL = 'Crop area — drag or use arrow keys'

/**
 * Turns the crop box (in % of the photo) into `background-*` styles that show exactly that region
 * inside a box of the same aspect. Exported for the unit test.
 */
export function cropPreviewStyle(url: string, area: Area | null) {
  if (!area || !area.width || !area.height) {
    return { backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: '50% 50%' }
  }
  const positionX = area.width >= 100 ? 0 : (area.x / (100 - area.width)) * 100
  const positionY = area.height >= 100 ? 0 : (area.y / (100 - area.height)) * 100
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${(100 / area.width) * 100}% ${(100 / area.height) * 100}%`,
    backgroundPosition: `${positionX}% ${positionY}%`,
    backgroundRepeat: 'no-repeat',
  }
}

/** A blob: URL for the picked photo whose lifetime is the effect's, so a StrictMode remount gets a fresh one. */
function useObjectUrl(file: File) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const next = URL.createObjectURL(file)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL must be created and revoked by the same effect run
    setUrl(next)
    return () => {
      URL.revokeObjectURL(next)
    }
  }, [file])
  return url
}

/**
 * Lets a member frame a photo before it is uploaded: drag (or arrow keys) to reposition,
 * pinch, wheel or the Zoom slider to zoom. Save cuts the framed pixels out of the original in the
 * browser (EXIF orientation respected) and hands back a WebP file. Mount it only while it is open:
 * focus moves inside, Tab stays inside, Escape and the backdrop cancel, and focus returns to the
 * button that opened it when it unmounts.
 */
export function ImageCropDialog({ file, shape, aspect, title, onCancel, onSave }: ImageCropDialogProps) {
  const titleId = useId()
  const zoomId = useId()
  const containerRef = useModalLayer<HTMLDivElement>({ onClose: onCancel })
  const imageUrl = useObjectUrl(file)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [pixelCrop, setPixelCrop] = useState<PixelCrop | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const onCropChange = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    setArea(croppedArea)
    setPixelCrop(croppedAreaPixels)
  }, [])

  async function save() {
    if (!pixelCrop || saving) return
    setSaving(true)
    setError('')
    try {
      const cropped = await cropImageToFile(file, pixelCrop, { maxEdge: CROP_MAX_EDGE_PX[shape] })
      // A browser that cannot crop (no decoder or encoder) still uploads the photo as picked.
      onSave(cropped ?? file)
    } catch {
      setError('Unable to crop this photo. Try again or cancel to keep the original.')
      setSaving(false)
    }
  }

  const round = shape === 'circle'
  const previewClass = round
    ? 'size-12 rounded-full'
    : aspect >= 2 ? 'h-10 w-40 rounded-md' : 'size-12 rounded-md'

  const dialog = (
    <div className="fixed inset-0 z-[80]">
      <div aria-hidden="true" onClick={onCancel} className="absolute inset-0 bg-navy-950/60 motion-safe:animate-[sheet-fade_200ms_ease-out]" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-12px_32px_rgb(7_27_45/0.18)] outline-none motion-safe:animate-[sheet-up_250ms_cubic-bezier(0.22,1,0.36,1)] md:inset-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:shadow-[var(--shadow-card)] md:motion-safe:animate-none"
      >
        <div className="flex min-h-14 items-center px-5 pt-2">
          <h2 id={titleId} className="text-[17px] font-bold text-navy-950">{title}</h2>
        </div>

        <div className="relative h-[60vw] min-h-56 max-h-[50dvh] w-full bg-navy-950 md:h-80 md:max-h-none">
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            aspect={aspect}
            cropShape={round ? 'round' : 'rect'}
            showGrid={false}
            keyboardStep={8}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropAreaChange={onCropChange}
            onCropComplete={onCropChange}
            cropperProps={{ 'aria-label': CROP_AREA_LABEL, tabIndex: 0 }}
            classes={{ cropAreaClassName: 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500' }}
          />
        </div>

        <div className="flex items-center gap-4 px-5 pt-4">
          <div className="min-w-0 flex-1">
            <label htmlFor={zoomId} className="block text-xs font-semibold text-navy-950">Zoom</label>
            <input
              id={zoomId}
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.currentTarget.value))}
              data-autofocus
              className="mt-1 block w-full cursor-pointer accent-ocean-700"
            />
          </div>
          <div className="shrink-0 text-center">
            <span aria-hidden="true" className={`block overflow-hidden bg-mist-100 ring-1 ring-mist-200 ${previewClass}`} style={imageUrl ? cropPreviewStyle(imageUrl, area) : undefined} data-testid="crop-preview" />
            <span className="mt-1 block text-[11px] font-medium text-muted">Preview</span>
          </div>
        </div>

        {error ? <p role="alert" className="mx-5 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p> : null}

        <div className="flex justify-end gap-2 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-navy-900 bg-white px-5 text-sm font-semibold text-navy-900 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !pixelCrop}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-navy-950 px-5 text-sm font-bold text-white transition hover:bg-ocean-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )

  // Rendered at the end of <body> so a transformed or clipped ancestor cannot trap the dialog.
  return typeof document === 'undefined' ? null : createPortal(dialog, document.body)
}
