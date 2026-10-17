'use client'

import { Camera, Pencil, Trash2 } from 'lucide-react'
import { useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from 'react'
import { ImageCropDialog } from '@/components/ui/image-crop-dialog'
import { cn } from '@/lib/cn'
import { downscaleImage, isDownscalableImage } from '@/lib/images/downscale-image'
import {
  completeCommunityMediaUploadAction,
  removeCommunityCoverAction,
  removeCommunityIconAction,
  requestCommunityMediaUploadAction,
} from '../media-actions'
import type { CommunityMediaKind } from '../media'

/** The community photo is a rounded square (1:1); the banner keeps the 4:1 cover ratio. */
const CROP: Record<CommunityMediaKind, { shape: 'rect'; aspect: number; title: string }> = {
  icon: { shape: 'rect', aspect: 1, title: 'Crop community photo' },
  cover: { shape: 'rect', aspect: 4, title: 'Crop community banner' },
}
const LABEL: Record<CommunityMediaKind, string> = { icon: 'community photo', cover: 'community banner' }

const subscribeToHydration = () => () => {}
const getHydratedSnapshot = () => true
const getServerHydratedSnapshot = () => false

/**
 * Round buttons that sit over the banner (top-right): a camera button that opens the picker, and
 * a bin to remove the current image. The photo uses `CommunityIconEditor` (an overlay) instead. Buttons are 36px on
 * desktop and 40px on phones so they are comfortable to tap. Only the group's owner, its
 * moderators and platform administrators see them (`canManage`).
 */
export function CommunityMediaControls({
  groupId,
  kind,
  hasImage,
  canManage,
}: {
  groupId: string
  kind: CommunityMediaKind
  hasImage: boolean
  canManage: boolean
}) {
  if (!canManage) return null
  return <ManagedCommunityMediaControls groupId={groupId} kind={kind} hasImage={hasImage} />
}

/**
 * Round H (H6): the community photo with its Change / Remove buttons in an overlay, so they never
 * cover the photo. The overlay appears on hover or when a button has keyboard focus; on phones and
 * touch screens a small "Edit" button beside the photo opens it. Only people who manage the
 * community (`canManage`) get it; everyone else sees the plain photo.
 */
export function CommunityIconEditor({
  groupId,
  hasImage,
  canManage,
  children,
}: {
  groupId: string
  hasImage: boolean
  canManage: boolean
  /** The photo tile. */
  children: ReactNode
}) {
  if (!canManage) return <>{children}</>
  return <ManagedCommunityMediaControls groupId={groupId} kind="icon" hasImage={hasImage} tile={children} />
}

const BUTTON_CLASS = 'inline-flex size-10 cursor-pointer items-center justify-center rounded-full border-2 border-white shadow-md disabled:cursor-not-allowed disabled:opacity-60 md:size-9'

function ManagedCommunityMediaControls({ groupId, kind, hasImage, tile }: { groupId: string; kind: CommunityMediaKind; hasImage: boolean; tile?: ReactNode }) {
  const removeAction = kind === 'icon' ? removeCommunityIconAction : removeCommunityCoverAction
  const [uploadError, setUploadError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const [removeError, setRemoveError] = useState('')
  const [removed, setRemoved] = useState(false)
  const [removing, startRemoving] = useTransition()
  const [cropping, setCropping] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Overlay layout only: opened with the touch "Edit" button.
  const [overlayOpen, setOverlayOpen] = useState(false)
  const label = LABEL[kind]
  const hydrated = useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerHydratedSnapshot)

  const imagePresent = removed ? false : uploaded ? true : hasImage

  /** Shrink in-browser, then PUT straight to S3. Only metadata/finalization goes through the Server Action. */
  async function submitImage(picked: File) {
    setUploadError('')
    setUploading(true)
    try {
      const image = await downscaleImage(picked, kind === 'icon' ? 'avatar' : 'cover')
      const ticket = await requestCommunityMediaUploadAction({
        groupId,
        kind,
        contentType: image.type,
        size: image.size,
      })
      if (!ticket.success || !ticket.uploadUrl || !ticket.key) throw new Error(ticket.error ?? 'Upload failed, try again.')

      const response = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': image.type },
        body: image,
      })
      if (!response.ok) throw new Error('Upload failed, try again.')

      const completed = await completeCommunityMediaUploadAction({ groupId, kind, key: ticket.key })
      if (!completed.success) throw new Error(completed.error ?? 'Upload failed, try again.')

      setUploaded(true)
      setRemoved(false)
      setCropping(null)
      if (inputRef.current) inputRef.current.value = ''
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Upload failed, try again.'
      setUploadError(message)
      throw new Error(message)
    } finally {
      setUploading(false)
    }
  }

  /** A photo the browser can re-encode is framed in the crop dialog first; a GIF is uploaded as it is. */
  function pickImage(picked: File) {
    if (isDownscalableImage(picked)) {
      setCropping(picked)
      return
    }
    void submitImage(picked).catch(() => undefined)
  }

  function cancelCrop() {
    setCropping(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function saveCrop(cropped: File) {
    await submitImage(cropped)
  }

  function removeImage() {
    if (removing) return
    setRemoveError('')
    startRemoving(async () => {
      const formData = new FormData()
      formData.set('groupId', groupId)
      const result = await removeAction(formData)
      if (!result.success) {
        setRemoveError(result.error ?? `Unable to remove ${label}.`)
        return
      }
      setRemoved(true)
    })
  }

  const error = uploadError || removeError
  const busy = uploading || removing

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      name="image"
      accept="image/jpeg,image/png,image/webp"
      className="sr-only"
      onChange={(event) => {
        setRemoveError('')
        setUploadError('')
        const picked = event.currentTarget.files?.[0]
        if (picked) {
          setRemoved(false)
          pickImage(picked)
        }
      }}
    />
  )

  const changeButton = (
    <button
      type="button"
      disabled={busy || !hydrated}
      onClick={() => inputRef.current?.click()}
      aria-label={`${imagePresent ? 'Change' : 'Add'} ${label}`}
      title={uploading ? 'Uploading…' : `${imagePresent ? 'Change' : 'Add'} ${label}`}
      className={cn(BUTTON_CLASS, 'bg-navy-950 text-white hover:bg-navy-800')}
    >
      <Camera aria-hidden="true" className="size-4" />
    </button>
  )

  const removeButton = imagePresent ? (
    <button
      type="button"
      disabled={busy || !hydrated}
      onClick={removeImage}
      aria-label={`Remove ${label}`}
      title={`Remove ${label}`}
      className={cn(BUTTON_CLASS, 'bg-white text-navy-950 hover:text-red-700')}
    >
      <Trash2 aria-hidden="true" className="size-4" />
    </button>
  ) : null

  const cropDialog = cropping ? (
    <ImageCropDialog
      file={cropping}
      shape={CROP[kind].shape}
      aspect={CROP[kind].aspect}
      title={CROP[kind].title}
      onCancel={cancelCrop}
      onSave={saveCrop}
    />
  ) : null

  if (tile !== undefined) {
    return (
      <div
        data-testid="community-icon-editor"
        className="group/icon relative w-fit"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOverlayOpen(false)
        }}
      >
        {tile}
        {fileInput}
        {/* Hidden until hover or keyboard focus inside it (or the Edit button opens it); never covers the photo otherwise. */}
        <div
          role="group"
          aria-label={`Edit ${label}`}
          data-open={overlayOpen ? 'true' : 'false'}
          className={cn(
            'pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-1.5 rounded-2xl bg-navy-950/55 opacity-0 transition-opacity',
            'group-hover/icon:pointer-events-auto group-hover/icon:opacity-100 group-focus-within/icon:pointer-events-auto group-focus-within/icon:opacity-100',
            overlayOpen && 'pointer-events-auto opacity-100',
          )}
        >
          {changeButton}
          {removeButton}
        </div>
        {/* Phones and touch screens have no hover: an always-visible Edit button beside the photo. */}
        <button
          type="button"
          aria-expanded={overlayOpen}
          aria-label={`Edit ${label}`}
          onClick={() => setOverlayOpen((open) => !open)}
          className="absolute bottom-0 left-full z-20 ml-2 hidden min-h-9 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border border-mist-200 bg-white px-3 text-xs font-semibold text-navy-950 shadow-sm hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 max-md:inline-flex pointer-coarse:inline-flex"
        >
          <Pencil aria-hidden="true" className="size-3.5" /> {overlayOpen ? 'Done' : 'Edit'}
        </button>
        {error && !cropping ? (
          <span role="alert" className="absolute left-0 top-full z-20 mt-2 w-64 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 shadow-sm">
            {error}
          </span>
        ) : null}
        {cropDialog}
      </div>
    )
  }

  return (
    <div className="relative flex items-center gap-2">
      <div>
        {fileInput}
        {changeButton}
      </div>

      {removeButton}

      {error && !cropping ? (
        <span role="alert" className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 shadow-sm">
          {error}
        </span>
      ) : null}

      {cropDialog}
    </div>
  )
}
