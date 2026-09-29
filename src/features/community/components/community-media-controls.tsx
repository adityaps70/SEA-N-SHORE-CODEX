'use client'

import { useRouter } from 'next/navigation'
import { Camera, Trash2 } from 'lucide-react'
import { startTransition, useActionState, useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { ImageCropDialog } from '@/components/ui/image-crop-dialog'
import { cn } from '@/lib/cn'
import { downscaleImage, isDownscalableImage } from '@/lib/images/downscale-image'
import {
  removeCommunityCoverAction,
  removeCommunityIconAction,
  uploadCommunityCoverAction,
  uploadCommunityIconAction,
  type CommunityMediaActionState,
} from '../media-actions'
import type { CommunityMediaKind } from '../media'

const initialState: CommunityMediaActionState = {}

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
 * Round buttons that sit over the banner (top-right) and the photo (bottom-right): a camera
 * button that opens the picker, and a bin to remove the current image. Buttons are 36px on
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

const BUTTON_CLASS = 'inline-flex size-10 items-center justify-center rounded-full border-2 border-white shadow-md disabled:opacity-60 md:size-9'

function ManagedCommunityMediaControls({ groupId, kind, hasImage }: { groupId: string; kind: CommunityMediaKind; hasImage: boolean }) {
  const router = useRouter()
  const uploadAction = kind === 'icon' ? uploadCommunityIconAction : uploadCommunityCoverAction
  const removeAction = kind === 'icon' ? removeCommunityIconAction : removeCommunityCoverAction
  const [state, formAction, uploading] = useActionState(uploadAction, initialState)
  const [removeError, setRemoveError] = useState('')
  const [removed, setRemoved] = useState(false)
  const [removing, startRemoving] = useTransition()
  const [cropping, setCropping] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const label = LABEL[kind]
  const hydrated = useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerHydratedSnapshot)

  const imagePresent = removed ? false : state.success ? true : hasImage

  useEffect(() => {
    if (!state.success) return
    if (inputRef.current) inputRef.current.value = ''
    router.refresh()
  }, [router, state])

  /** Shrunk in the browser first (photo: 800px long edge, banner: 1920px, WebP), then posted as `image`. */
  async function submitImage(picked: File) {
    const image = await downscaleImage(picked, kind === 'icon' ? 'avatar' : 'cover')
    const formData = new FormData()
    formData.set('groupId', groupId)
    formData.set('image', image, image.name)
    startTransition(() => formAction(formData))
  }

  /** A photo the browser can re-encode is framed in the crop dialog first; a GIF is uploaded as it is. */
  function pickImage(picked: File) {
    if (isDownscalableImage(picked)) {
      setCropping(picked)
      return
    }
    void submitImage(picked)
  }

  function cancelCrop() {
    setCropping(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function saveCrop(cropped: File) {
    setCropping(null)
    void submitImage(cropped)
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
      router.refresh()
    })
  }

  const error = state.error ?? removeError
  const busy = uploading || removing

  return (
    <div className="relative flex items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="groupId" value={groupId} />
        <input
          ref={inputRef}
          type="file"
          name="image"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            setRemoveError('')
            const picked = event.currentTarget.files?.[0]
            if (picked) {
              setRemoved(false)
              pickImage(picked)
            }
          }}
        />
        <button
          type="button"
          disabled={busy || !hydrated}
          onClick={() => inputRef.current?.click()}
          aria-label={`${imagePresent ? 'Change' : 'Add'} ${label}`}
          title={uploading ? 'Uploading…' : `${imagePresent ? 'Change' : 'Add'} ${label}`}
          className={cn(BUTTON_CLASS, 'bg-navy-950 text-white hover:bg-ocean-700')}
        >
          <Camera aria-hidden="true" className="size-4" />
        </button>
      </form>

      {imagePresent ? (
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
      ) : null}

      {error ? (
        <span role="alert" className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 shadow-sm">
          {error}
        </span>
      ) : null}

      {cropping ? (
        <ImageCropDialog
          file={cropping}
          shape={CROP[kind].shape}
          aspect={CROP[kind].aspect}
          title={CROP[kind].title}
          onCancel={cancelCrop}
          onSave={saveCrop}
        />
      ) : null}
    </div>
  )
}
