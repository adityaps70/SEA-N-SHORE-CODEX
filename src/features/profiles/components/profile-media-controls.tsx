'use client'

import { useRouter } from 'next/navigation'
import { Camera, Trash2 } from 'lucide-react'
import { useActionState, useEffect, useRef } from 'react'
import {
  removeAvatarAction,
  removeCoverAction,
  uploadAvatarAction,
  uploadCoverAction,
  type ProfileMediaActionState,
} from '../profile-media-actions'

const initialState: ProfileMediaActionState = {}

export function ProfileMediaControls({
  kind,
  hasImage,
}: {
  kind: 'avatar' | 'cover'
  hasImage: boolean
}) {
  const router = useRouter()
  const uploadAction = kind === 'avatar' ? uploadAvatarAction : uploadCoverAction
  const removeAction = kind === 'avatar' ? removeAvatarAction : removeCoverAction
  const [state, formAction, pending] = useActionState(uploadAction, initialState)
  const inputRef = useRef<HTMLInputElement>(null)
  const label = kind === 'avatar' ? 'profile photo' : 'cover photo'

  useEffect(() => {
    if (!state.success) return
    if (inputRef.current) inputRef.current.value = ''
    router.refresh()
  }, [router, state.success])

  return (
    <div className="relative flex items-center gap-2">
      <form action={formAction}>
        <input
          ref={inputRef}
          type="file"
          name="image"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            if (event.currentTarget.files?.length) event.currentTarget.form?.requestSubmit()
          }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          aria-label={`${hasImage ? 'Change' : 'Add'} ${label}`}
          className={kind === 'avatar'
            ? 'inline-flex size-10 items-center justify-center rounded-full border-2 border-white bg-navy-950 text-white shadow-md hover:bg-ocean-700 disabled:opacity-60'
            : 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/70 bg-white/95 px-3 text-sm font-semibold text-navy-950 shadow-sm hover:bg-white disabled:opacity-60'}
        >
          <Camera aria-hidden="true" className="size-4" />
          {kind === 'cover' ? (pending ? 'Uploading…' : hasImage ? 'Change cover' : 'Add cover') : null}
        </button>
        {state.error ? (
          <span role="alert" className="absolute right-0 top-full mt-2 w-64 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 shadow-sm">
            {state.error}
          </span>
        ) : null}
      </form>

      {hasImage ? (
        <form action={removeAction}>
          <button
            type="submit"
            aria-label={`Remove ${label}`}
            className={kind === 'avatar'
              ? 'inline-flex size-8 items-center justify-center rounded-full border-2 border-white bg-white text-navy-950 shadow-md hover:text-red-700'
              : 'inline-flex size-10 items-center justify-center rounded-xl border border-white/70 bg-white/95 text-navy-950 shadow-sm hover:text-red-700'}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </form>
      ) : null}
    </div>
  )
}
