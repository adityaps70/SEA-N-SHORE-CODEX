'use client'

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ImageUp } from 'lucide-react'
import { ImageCropDialog } from '@/components/ui/image-crop-dialog'
import { primaryButtonClass } from '@/components/ui/interactive-styles'
import { downscaleImage, isDownscalableImage } from '@/lib/images/downscale-image'
import { createCommunity, type CreateCommunityState } from '../create-actions'
import { CREATE_AS_SELF } from '../eligibility'
import { COMMUNITY_IMAGE_CONTENT_TYPES, validateCommunityImage, type CommunityMediaKind } from '../media'
import { GROUP_DESCRIPTION_MAX_LENGTH, GROUP_NAME_MAX_LENGTH, GROUP_RULES_MAX_LENGTH, type GroupJoinPolicy, type GroupVisibility } from '../types'

/** One identity the member may create as: themselves (`me`) or an organization (its id). */
export type CreateCommunityIdentity = { value: string; label: string; hint?: string }

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm font-normal text-ink outline-none focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100'
const areaClass = 'w-full rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm font-normal leading-6 text-ink outline-none focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100'
const labelClass = 'block text-sm font-semibold text-navy-950'
const hintClass = 'mt-1 block text-xs font-normal text-muted'
const fileClass = 'block w-full cursor-pointer text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-navy-950 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-navy-900'
const choiceClass = 'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-mist-200 bg-white px-3 py-2.5 text-sm text-navy-950 transition hover:bg-mist-50 has-[:checked]:border-ocean-400 has-[:checked]:bg-ocean-50'

const IMAGE_TYPES = new Set<string>(COMMUNITY_IMAGE_CONTENT_TYPES)

/** The profile photo is a rounded square (1:1); the banner is the 4:1 strip above it. */
const CROP: Record<CommunityMediaKind, { aspect: number; title: string; downscale: 'avatar' | 'cover' }> = {
  icon: { aspect: 1, title: 'Adjust the community photo', downscale: 'avatar' },
  cover: { aspect: 4, title: 'Adjust the banner', downscale: 'cover' },
}

const JOIN_OPTIONS: Array<{ value: GroupJoinPolicy; label: string; hint: string }> = [
  { value: 'open', label: 'Open — anyone can join', hint: 'Members join at once and can post straight away.' },
  { value: 'approval', label: 'Approval required — a moderator approves requests', hint: 'Requests wait on the Members tab until you or a moderator approves them.' },
]

const VISIBILITY_OPTIONS: Array<{ value: GroupVisibility; label: string; hint: string }> = [
  { value: 'public', label: 'Public', hint: 'Anyone on Sea N Shore can read the posts and see who is in.' },
  { value: 'private', label: 'Private', hint: 'Posts and members are visible to members only.' },
]

function usePreview() {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])
  function previewFile(file: File | null | undefined) {
    setPreview(file && IMAGE_TYPES.has(file.type) && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null)
  }
  return [preview, previewFile] as const
}

/** Puts the cropped photo into the file input so the plain form submit sends it. */
function replaceInputFile(input: HTMLInputElement | null, file: File) {
  if (!input || typeof DataTransfer !== 'function') return false
  try {
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    return input.files?.[0] === file
  } catch {
    return false
  }
}

/**
 * Create a community (round 9C): who it is for, name, description, rules, join setting,
 * visibility and the optional banner and photo. The server action re-checks eligibility.
 */
export function CreateCommunityForm({ identities, initialAs }: { identities: CreateCommunityIdentity[]; initialAs?: string | null }) {
  const [state, formAction, pending] = useActionState<CreateCommunityState, FormData>(createCommunity, null)
  const [clientError, setClientError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [coverPreview, previewCover] = usePreview()
  const [iconPreview, previewIcon] = usePreview()
  const [cropping, setCropping] = useState<{ kind: CommunityMediaKind; file: File } | null>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const iconInputRef = useRef<HTMLInputElement>(null)
  const preselected = initialAs && identities.some((identity) => identity.value === initialAs) ? initialAs : null
  const defaultAs = preselected ?? identities[0]?.value ?? CREATE_AS_SELF

  const inputFor = (kind: CommunityMediaKind) => (kind === 'cover' ? coverInputRef : iconInputRef).current
  const previewFor = (kind: CommunityMediaKind) => (kind === 'cover' ? previewCover : previewIcon)

  function onImageChange(kind: CommunityMediaKind, event: ChangeEvent<HTMLInputElement>) {
    setClientError(null)
    const file = event.target.files?.[0]
    if (!file) {
      previewFor(kind)(null)
      return
    }
    const validation = validateCommunityImage(file)
    if (!validation.ok) {
      event.target.value = ''
      previewFor(kind)(null)
      setClientError(`${kind === 'cover' ? 'The banner' : 'The profile photo'}: ${validation.error}`)
      return
    }
    if (isDownscalableImage(file)) {
      setCropping({ kind, file })
      return
    }
    previewFor(kind)(file)
  }

  function cancelCrop() {
    if (!cropping) return
    const input = inputFor(cropping.kind)
    if (input) input.value = ''
    previewFor(cropping.kind)(null)
    setCropping(null)
  }

  async function saveCrop(cropped: File) {
    if (!cropping) return
    const kind = cropping.kind
    const original = cropping.file
    setCropping(null)
    const scaled = await downscaleImage(cropped, CROP[kind].downscale).catch(() => cropped)
    const replaced = replaceInputFile(inputFor(kind), scaled)
    previewFor(kind)(replaced ? scaled : original)
  }

  const error = clientError ?? (state && !state.ok ? state.error : null)

  return (
    <form action={formAction} aria-label="Create a community" className="space-y-5">
      {identities.length > 1 ? (
        <fieldset>
          <legend className={labelClass}>Create as</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {identities.map((identity) => (
              <label key={identity.value} className={choiceClass}>
                <input type="radio" name="as" value={identity.value} defaultChecked={identity.value === defaultAs} className="mt-1 size-4 accent-ocean-700" />
                <span className="min-w-0">
                  <span className="block font-semibold">{identity.label}</span>
                  {identity.hint ? <span className="block text-xs text-muted">{identity.hint}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="as" value={defaultAs} />
      )}

      <label className={labelClass}>
        Name
        <input
          name="name"
          required
          minLength={2}
          maxLength={GROUP_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={`${inputClass} mt-1.5`}
          placeholder="e.g. Tanker Cargo Officers"
          aria-describedby="community-name-hint"
        />
        <span id="community-name-hint" className={hintClass}>{GROUP_NAME_MAX_LENGTH - name.length} characters left. The page address is made from the name.</span>
      </label>

      <label className={labelClass}>
        Description
        <textarea name="description" rows={4} maxLength={GROUP_DESCRIPTION_MAX_LENGTH} className={`${areaClass} mt-1.5`} placeholder="What the community is about and who it is for." />
      </label>

      <label className={labelClass}>
        Rules
        <textarea name="rules" rows={4} maxLength={GROUP_RULES_MAX_LENGTH} className={`${areaClass} mt-1.5`} placeholder="What members should know before posting." />
      </label>

      <fieldset>
        <legend className={labelClass}>Join setting</legend>
        <div className="mt-2 grid gap-2">
          {JOIN_OPTIONS.map((option) => (
            <label key={option.value} className={choiceClass}>
              <input type="radio" name="joinPolicy" value={option.value} defaultChecked={option.value === 'open'} className="mt-1 size-4 accent-ocean-700" />
              <span className="min-w-0">
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-xs text-muted">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={labelClass}>Visibility</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {VISIBILITY_OPTIONS.map((option) => (
            <label key={option.value} className={choiceClass}>
              <input type="radio" name="visibility" value={option.value} defaultChecked={option.value === 'public'} className="mt-1 size-4 accent-ocean-700" />
              <span className="min-w-0">
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-xs text-muted">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section aria-labelledby="community-images-heading" className="rounded-2xl border border-mist-100 bg-mist-50/50 p-4">
        <h2 id="community-images-heading" className="text-sm font-bold text-navy-950">Banner and profile photo</h2>
        <p className="mt-0.5 text-xs text-muted">Optional. You can add or change them later from the community page.</p>
        <div className="mt-3 overflow-hidden rounded-2xl border border-mist-100 bg-white">
          <div aria-hidden="true" className="relative h-20 bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))] sm:h-28">
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
              <img src={coverPreview} alt="" className="size-full object-cover" />
            ) : null}
          </div>
          <div className="-mt-8 px-4 pb-3">
            <span className="relative grid size-16 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-white shadow-sm">
              {iconPreview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
                <img src={iconPreview} alt="" className="size-full object-cover" />
              ) : (
                <ImageUp aria-hidden="true" className="size-6 text-ocean-700" />
              )}
            </span>
          </div>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Banner
            <input ref={coverInputRef} name="cover" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onImageChange('cover', event)} className={`${fileClass} mt-2`} />
            <span className={hintClass}>Wide image (4:1). JPG, PNG or WebP, up to 5 MB.</span>
          </label>
          <label className={labelClass}>
            Profile photo
            <input ref={iconInputRef} name="icon" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onImageChange('icon', event)} className={`${fileClass} mt-2`} />
            <span className={hintClass}>Square image. JPG, PNG or WebP, up to 5 MB.</span>
          </label>
        </div>
      </section>

      {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || Boolean(cropping)} className={`${primaryButtonClass} max-md:w-full`}>{pending ? 'Creating…' : 'Create community'}</button>
        <p className="text-xs text-muted">You become the owner and can appoint moderators from the Members tab.</p>
      </div>

      {cropping ? (
        <ImageCropDialog
          file={cropping.file}
          shape="rect"
          aspect={CROP[cropping.kind].aspect}
          title={CROP[cropping.kind].title}
          onCancel={cancelCrop}
          onSave={(file) => { void saveCrop(file) }}
        />
      ) : null}
    </form>
  )
}
