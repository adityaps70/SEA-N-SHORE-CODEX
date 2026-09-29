'use client'

import { downscaleImage } from '@/lib/images/downscale-image'
import { avatarSizes } from '@/lib/images/media-image-source'
import { MediaImage } from '@/components/ui/media-image'
import { useActionState, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { BarChart3, Check, ChevronDown, FileText, Globe, Hash, ImagePlus, MessageCircleQuestion, PencilLine, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'
import {
  createPost,
  createPostMediaUploads,
  discardPendingPostMedia,
  type PostComposerState,
} from '../actions'
import type { ComposeRequest } from '../compose-request'
import { loadPostingOrganizations } from '../organization-post-actions'
import {
  POST_DOCUMENT_MAX_PAGES,
  POST_IMAGE_MAX_COUNT,
  isVideoPostMediaMime,
  validatePostMediaMetadata,
  type PostMediaMime,
} from '../media-policy'
import { readPdfPageCount } from '../pdf-page-count'
import type { ComposerProfile, PostCategory, PostingOrganization } from '../types'
import { EmojiPicker } from './emoji-picker'
import { MentionInput, type SelectedMention } from './mention-input'
import { uploadPostMediaFile } from './upload-post-media'

const initialState: PostComposerState = {}
const POST_MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm'
const POST_DOCUMENT_ACCEPT = 'application/pdf'
const POST_CHARACTER_LIMIT = 5000

type ComposerMode = 'update' | 'question' | 'poll'
type PollField = { id: string; value: string }
type ComposerDraft = {
  body: string
  mode: ComposerMode
  topicTags: string
  pollOptions: string[]
  mentions: SelectedMention[]
}

type ComposerMedia = {
  file: File
  localUrl: string
  postId: string | null
  storagePath: string | null
  mimeType: PostMediaMime
  size: number
  pageCount: number | null
  progress: number
  status: 'requesting' | 'uploading' | 'ready' | 'error'
  error?: string
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function newPollFields(prefix: string, values: string[] = ['', '']): PollField[] {
  const source = values.length >= 2 ? values.slice(0, 6) : ['', '']
  return source.map((value, index) => ({ id: `${prefix}-${index + 1}`, value }))
}

function normalizedTopicTags(value: string) {
  return value
    .split(',')
    .map((item) => item.trim().replace(/^#+/, '').replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
    .slice(0, 5)
}

function bodyWithTopicTags(body: string, topicTags: string) {
  const tags = normalizedTopicTags(topicTags)
  if (!tags.length) return body
  const suffix = tags.map((tag) => `#${tag}`).join(' ')
  return `${body.trimEnd()}\n\n${suffix}`
}

function isImageMime(mimeType: string) {
  return mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp'
}

function mediaStatus(media: ComposerMedia) {
  if (media.status === 'requesting') return 'Preparing media…'
  if (media.status === 'uploading') return `Uploading ${media.progress}%`
  if (media.status === 'ready') return 'Ready to post'
  return media.error ?? 'Upload failed'
}

function ProfileAvatar({ profile, size = 'size-12' }: { profile: ComposerProfile; size?: string }) {
  return (
    <div className={`relative grid ${size} shrink-0 place-items-center overflow-hidden rounded-full bg-mist-100 text-sm font-semibold text-navy-950 ring-1 ring-mist-100`}>
      {profile.avatarUrl ? (
        <MediaImage src={profile.avatarUrl} alt={`${profile.fullName}'s profile photo`} fill sizes={avatarSizes(size)} className="object-cover" fallback={initials(profile.fullName)} />
      ) : initials(profile.fullName)}
    </div>
  )
}

function OrganizationAvatar({ organization, size = 'size-12' }: { organization: PostingOrganization; size?: string }) {
  return (
    <div className={`relative grid ${size} shrink-0 place-items-center overflow-hidden rounded-xl bg-navy-950 text-xs font-black text-white ring-1 ring-mist-100`}>
      {organization.logoUrl ? (
        // Organization logos come from the signed-in first-party logo route, so they are shown as they are.
        <MediaImage src={organization.logoUrl} alt={`${organization.name} logo`} fill sizes={avatarSizes(size)} className="bg-white object-contain p-1" fallback={initials(organization.name)} />
      ) : initials(organization.name)}
    </div>
  )
}

/**
 * "Post as" chooser in the composer header: the member themself, or an organization they can
 * post for (owner, administrator or content role of a verified organization).
 */
function PostAsChooser({ profile, organizations, value, onChange, disabled }: {
  profile: ComposerProfile
  organizations: PostingOrganization[]
  value: string | null
  onChange(companyId: string | null): void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, close, { triggerRef })
  const selected = organizations.find((organization) => organization.id === value) ?? null

  useEffect(() => {
    if (!open) return
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    ;(checked ?? items?.[0])?.focus()
  }, [open])

  function choose(companyId: string | null) {
    onChange(companyId)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function onRootKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Close only this menu, not the whole composer dialog.
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined
    if (event.key === 'ArrowDown') next = items[(index + 1) % items.length]
    else if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length]
    else if (event.key === 'Home') next = items[0]
    else if (event.key === 'End') next = items[items.length - 1]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  const optionClass = 'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none'

  return (
    <div ref={rootRef} className="relative min-w-[min(100%,15rem)] flex-1" onKeyDown={onRootKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Post as ${selected ? selected.name : `yourself, ${profile.fullName}`}. Change who this post is from`}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-mist-200 bg-white p-1.5 pr-3 text-left transition hover:border-ocean-200 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {selected ? <OrganizationAvatar organization={selected} size="size-11" /> : <ProfileAvatar profile={profile} size="size-11" />}
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">Post as</span>
          <span className="block truncate font-semibold text-navy-950">{selected ? selected.name : profile.fullName}</span>
          <span className="block truncate text-xs text-muted">{selected ? 'Organization' : profile.rank ?? profile.headline ?? 'Maritime professional'}</span>
        </span>
        <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Post as"
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 top-full z-20 mt-1 w-[min(22rem,calc(100vw-3rem))] overflow-hidden rounded-2xl border border-mist-100 bg-white p-1.5 shadow-xl"
        >
          <button type="button" role="menuitemradio" aria-checked={!selected} onClick={() => choose(null)} className={optionClass}>
            <ProfileAvatar profile={profile} size="size-9" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-navy-950">{profile.fullName}</span>
              <span className="block text-xs text-muted">Yourself</span>
            </span>
            {!selected ? <Check aria-hidden="true" className="size-4 shrink-0 text-ocean-700" /> : null}
          </button>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Organizations you post for</p>
          {organizations.map((organization) => (
            <button key={organization.id} type="button" role="menuitemradio" aria-checked={selected?.id === organization.id} onClick={() => choose(organization.id)} className={optionClass}>
              <OrganizationAvatar organization={organization} size="size-9" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-navy-950">{organization.name}</span>
                <span className="block text-xs text-muted">Organization</span>
              </span>
              {selected?.id === organization.id ? <Check aria-hidden="true" className="size-4 shrink-0 text-ocean-700" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function PostComposer({
  profile,
  defaultCategory,
  postingOrganizations,
  defaultOrganizationId,
  onPosted,
  composeRequest,
  hideTriggerOnPhones = false,
}: {
  profile: ComposerProfile
  defaultCategory?: PostCategory
  /** Organizations the member can post for. Loaded when the composer first opens if not given. */
  postingOrganizations?: PostingOrganization[]
  /** Start with "Post as" set to this organization (organization pages). */
  defaultOrganizationId?: string
  /** Called after a post is published, e.g. to reload an organization's post list. */
  onPosted?(): void
  /** `/home?compose=…`: open the composer in this mode on load, then drop the query parameter. */
  composeRequest?: ComposeRequest
  /** Home on phones: no "Start a post" card (the Post tab's Create sheet opens the composer). */
  hideTriggerOnPhones?: boolean
}) {
  const router = useRouter()
  const pollIdPrefix = useId()
  const nextPollFieldNumber = useRef(3)
  const formRef = useRef<HTMLFormElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const documentInputRef = useRef<HTMLInputElement>(null)
  const mediaStateRef = useRef<ComposerMedia[]>([])
  const uploadSequenceRef = useRef(0)
  const draftKey = `sea-n-shore:post-draft:${profile.id}${defaultOrganizationId ? `:${defaultOrganizationId}` : ''}`
  const [open, setOpen] = useState(false)
  const [loadedOrganizations, setLoadedOrganizations] = useState<PostingOrganization[] | null>(null)
  const [organizationsError, setOrganizationsError] = useState(false)
  const organizationsRequestedRef = useRef(false)
  const organizations = postingOrganizations ?? loadedOrganizations ?? []
  const [postAs, setPostAs] = useState<string | null>(defaultOrganizationId ?? null)
  const postAsOrganization = organizations.find((organization) => organization.id === postAs) ?? null
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<SelectedMention[]>([])
  const [mode, setMode] = useState<ComposerMode>('update')
  const [topicTags, setTopicTags] = useState('')
  const [pollFields, setPollFields] = useState<PollField[]>(() => newPollFields(pollIdPrefix))
  const [media, setMediaState] = useState<ComposerMedia[]>([])
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [draftHydrated, setDraftHydrated] = useState(false)
  /** Photo / Document button to point at when the file picker could not open by itself. */
  const [pickerHint, setPickerHint] = useState<'photo' | 'document' | null>(null)
  const handledComposeRef = useRef<ComposeRequest | null>(null)
  const autoPickRef = useRef<'photo' | 'document' | null>(null)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey)
      if (saved) {
        const draft = JSON.parse(saved) as Partial<ComposerDraft>
        const restoredMode: ComposerMode = draft.mode === 'question' || draft.mode === 'poll' ? draft.mode : 'update'
        const restoredBody = typeof draft.body === 'string' ? draft.body : ''
        const restoredTags = typeof draft.topicTags === 'string' ? draft.topicTags : ''
        const restoredPoll = Array.isArray(draft.pollOptions) ? draft.pollOptions.filter((item): item is string => typeof item === 'string') : []
        const restoredMentions = Array.isArray(draft.mentions)
          ? draft.mentions.filter((item): item is SelectedMention => Boolean(item && typeof item.profileId === 'string' && typeof item.label === 'string'))
          : []
        setBody(restoredBody)
        setMode(restoredMode)
        setTopicTags(restoredTags)
        setMentions(restoredMentions)
        if (restoredPoll.length >= 2) setPollFields(newPollFields(pollIdPrefix, restoredPoll))
      }
    } catch {
      window.localStorage.removeItem(draftKey)
    } finally {
      setDraftHydrated(true)
    }
  }, [draftKey, pollIdPrefix])

  useEffect(() => {
    if (!draftHydrated) return
    const draft: ComposerDraft = {
      body,
      mode,
      topicTags,
      pollOptions: pollFields.map((field) => field.value),
      mentions,
    }
    const hasDraft = Boolean(body.trim() || topicTags.trim() || mode !== 'update' || draft.pollOptions.some((item) => item.trim()))
    if (hasDraft) window.localStorage.setItem(draftKey, JSON.stringify(draft))
    else window.localStorage.removeItem(draftKey)
  }, [body, draftHydrated, draftKey, mentions, mode, pollFields, topicTags])

  // /home?compose=… (phone Create sheet): open in the requested mode once the draft is restored.
  useEffect(() => {
    if (!composeRequest) {
      handledComposeRef.current = null
      return
    }
    if (!draftHydrated || handledComposeRef.current === composeRequest) return
    handledComposeRef.current = composeRequest
    if (composeRequest === 'question' || composeRequest === 'poll') setMode(composeRequest)
    if (composeRequest === 'photo' || composeRequest === 'document') {
      // Photos and documents cannot go on a poll.
      setMode((current) => current === 'poll' ? 'update' : current)
      setPickerHint(composeRequest)
      autoPickRef.current = composeRequest
    }
    setOpen(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('compose')
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })
  }, [composeRequest, draftHydrated, router])

  // Browsers open a file picker only right after a tap; try it, and keep the button highlighted otherwise.
  useEffect(() => {
    if (!open || !autoPickRef.current) return
    const kind = autoPickRef.current
    autoPickRef.current = null
    const input = kind === 'photo' ? mediaInputRef.current : documentInputRef.current
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
    if (input && activation?.isActive) {
      try {
        input.click()
      } catch {
        // The highlighted button stays as the way in.
      }
    }
  }, [open])

  // The home feed does not pass the list: load it the first time the composer opens.
  useEffect(() => {
    if (!open || postingOrganizations || organizationsRequestedRef.current) return
    organizationsRequestedRef.current = true
    const failed = () => {
      organizationsRequestedRef.current = false
      setOrganizationsError(true)
    }
    loadPostingOrganizations()
      .then((result) => {
        if (!result.ok) return failed()
        setLoadedOrganizations(result.organizations)
        setOrganizationsError(false)
      })
      .catch(failed)
  }, [open, postingOrganizations])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => document.getElementById('feed-post-body')?.focus(), 0)
    function onKeyDown(event: KeyboardEvent) {
      // A menu inside the composer (Post as, emoji, mentions) already handled this Escape.
      if (event.key === 'Escape' && !event.defaultPrevented) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  function setMedia(next: ComposerMedia[]) {
    mediaStateRef.current = next
    setMediaState(next)
  }

  function updateMediaByUrl(localUrl: string, update: (media: ComposerMedia) => ComposerMedia) {
    const next = mediaStateRef.current.map((item) => item.localUrl === localUrl ? update(item) : item)
    setMedia(next)
  }

  function discardMediaReference(snapshot: ComposerMedia) {
    if (!snapshot.postId || !snapshot.storagePath) return
    void discardPendingPostMedia({
      postId: snapshot.postId,
      storagePath: snapshot.storagePath,
      mimeType: snapshot.mimeType,
    })
  }

  function clearMedia(options: { discard: boolean }) {
    uploadSequenceRef.current += 1
    const snapshots = mediaStateRef.current
    for (const snapshot of snapshots) {
      URL.revokeObjectURL(snapshot.localUrl)
      if (options.discard) discardMediaReference(snapshot)
    }
    if (mediaInputRef.current) mediaInputRef.current.value = ''
    if (documentInputRef.current) documentInputRef.current.value = ''
    setMedia([])
    setMediaError(null)
  }

  function removeMedia(localUrl: string) {
    const snapshot = mediaStateRef.current.find((item) => item.localUrl === localUrl)
    if (!snapshot || snapshot.status === 'requesting' || snapshot.status === 'uploading') return
    URL.revokeObjectURL(snapshot.localUrl)
    discardMediaReference(snapshot)
    setMedia(mediaStateRef.current.filter((item) => item.localUrl !== localUrl))
    if (mediaInputRef.current) mediaInputRef.current.value = ''
    if (documentInputRef.current) documentInputRef.current.value = ''
    setMediaError(null)
  }

  function resetComposer(options: { discardMedia: boolean; clearDraft: boolean }) {
    if (mediaStateRef.current.length) clearMedia({ discard: options.discardMedia })
    formRef.current?.reset()
    setBody('')
    setMentions([])
    setMode('update')
    setTopicTags('')
    nextPollFieldNumber.current = 3
    setPollFields(newPollFields(pollIdPrefix))
    if (options.clearDraft) window.localStorage.removeItem(draftKey)
  }

  function closeComposer() {
    if (mediaStateRef.current.length) clearMedia({ discard: true })
    setPickerHint(null)
    setOpen(false)
  }

  function openComposer(nextMode?: ComposerMode) {
    if (nextMode) chooseMode(nextMode)
    setOpen(true)
  }

  const [state, formAction, pending] = useActionState(async (previousState: PostComposerState, formData: FormData) => {
    const rawBody = formData.get('body')
    const rawTags = formData.get('topicTags')
    const publishBody = bodyWithTopicTags(typeof rawBody === 'string' ? rawBody : '', typeof rawTags === 'string' ? rawTags : '')
    if (publishBody.length > POST_CHARACTER_LIMIT) {
      return { fieldErrors: { body: [`Keep the post, including topic tags, within ${POST_CHARACTER_LIMIT} characters.`] } }
    }
    formData.set('body', publishBody)
    const nextState = await createPost(previousState, formData)
    if (nextState.ok) {
      resetComposer({ discardMedia: false, clearDraft: true })
      setOpen(false)
      router.refresh()
      onPosted?.()
    }
    return nextState
  }, initialState)

  function chooseMode(nextMode: ComposerMode) {
    setMode(nextMode)
    if (nextMode === 'poll' && mediaStateRef.current.length) clearMedia({ discard: true })
  }

  function addPollField() {
    setPollFields((current) => {
      const id = `${pollIdPrefix}-${nextPollFieldNumber.current}`
      nextPollFieldNumber.current += 1
      return [...current, { id, value: '' }]
    })
  }

  async function uploadFiles(files: Array<{ file: File; pageCount: number | null }>, options: { appendImages?: boolean } = {}) {
    const existingImages = options.appendImages
      ? mediaStateRef.current.filter((item) => isImageMime(item.mimeType) && item.status === 'ready')
      : []
    const existingPostId = existingImages[0]?.postId ?? undefined

    if (!options.appendImages && mediaStateRef.current.length) clearMedia({ discard: true })

    const sequence = uploadSequenceRef.current + 1
    uploadSequenceRef.current = sequence
    const pendingItems: ComposerMedia[] = files.map(({ file, pageCount }) => ({
      file,
      localUrl: URL.createObjectURL(file),
      postId: null,
      storagePath: null,
      mimeType: file.type as PostMediaMime,
      size: file.size,
      pageCount,
      progress: 0,
      status: 'requesting',
    }))
    setMedia([...existingImages, ...pendingItems])
    setMediaError(null)

    const target = await createPostMediaUploads({
      ...(existingPostId ? { postId: existingPostId } : {}),
      files: files.map(({ file, pageCount }) => ({
        mimeType: file.type,
        size: file.size,
        fileName: file.name,
        pageCount,
      })),
    })

    if (uploadSequenceRef.current !== sequence) {
      pendingItems.forEach((item) => URL.revokeObjectURL(item.localUrl))
      return
    }

    if (!target.ok || target.uploads.length !== pendingItems.length) {
      const error = target.ok ? 'We could not prepare your media upload. Please try again.' : target.error
      setMedia([...existingImages, ...pendingItems.map((item) => ({ ...item, status: 'error' as const, error }))])
      return
    }

    const uploading = pendingItems.map((item, index) => {
      const upload = target.uploads[index]
      if (!upload) return { ...item, status: 'error' as const, error: 'We could not prepare this upload.' }
      return {
        ...item,
        postId: upload.postId,
        storagePath: upload.storagePath,
        mimeType: upload.mimeType,
        size: upload.size,
        status: 'uploading' as const,
      }
    })
    setMedia([...existingImages, ...uploading])

    try {
      await Promise.all(uploading.map(async (item, index) => {
        const upload = target.uploads[index]
        if (!upload || !item.storagePath) throw new Error('media_upload_target_missing')
        await uploadPostMediaFile({
          uploadUrl: upload.uploadUrl,
          file: item.file,
          onProgress: (progress) => {
            if (uploadSequenceRef.current !== sequence) return
            updateMediaByUrl(item.localUrl, (current) => ({ ...current, progress }))
          },
        })
        if (uploadSequenceRef.current !== sequence) {
          discardMediaReference(item)
          return
        }
        updateMediaByUrl(item.localUrl, (current) => ({ ...current, progress: 100, status: 'ready', error: undefined }))
      }))
    } catch {
      if (uploadSequenceRef.current !== sequence) return
      for (const item of uploading) discardMediaReference(item)
      const failedUrls = new Set(uploading.map((item) => item.localUrl))
      setMedia(mediaStateRef.current.map((item) => failedUrls.has(item.localUrl)
        ? { ...item, status: 'error', error: 'We could not upload this media. Please try again.' }
        : item))
    }
  }

  async function choosePhotoVideo(picked: File[]) {
    if (!picked.length) return
    setPickerHint(null)
    // Photos are shrunk in the browser first (max 2048px long edge, WebP), so validation and the
    // upload see the small file. Videos, GIFs and anything the browser cannot decode pass through.
    const files = await Promise.all(picked.map((file) => downscaleImage(file, 'post')))
    const existingImages = mediaStateRef.current.length > 0 && mediaStateRef.current.every((item) => isImageMime(item.mimeType))
      ? mediaStateRef.current
      : []
    const allNewImages = files.every((file) => isImageMime(file.type))

    if (files.length > 1 && !allNewImages) {
      setMediaError('Choose up to 10 photos, or attach one video or one PDF document.')
      if (mediaInputRef.current) mediaInputRef.current.value = ''
      return
    }

    if (allNewImages && existingImages.length + files.length > POST_IMAGE_MAX_COUNT) {
      setMediaError(`Add no more than ${POST_IMAGE_MAX_COUNT} photos to one post.`)
      if (mediaInputRef.current) mediaInputRef.current.value = ''
      return
    }

    for (const file of files) {
      const validation = validatePostMediaMetadata({ mimeType: file.type, size: file.size })
      if (!validation.ok) {
        setMediaError(validation.error)
        if (mediaInputRef.current) mediaInputRef.current.value = ''
        return
      }
    }

    const appendImages = allNewImages && existingImages.length > 0
    await uploadFiles(files.map((file) => ({ file, pageCount: null })), { appendImages })
  }

  async function chooseDocument(file: File | undefined) {
    if (!file) return
    setPickerHint(null)
    const validation = validatePostMediaMetadata({ mimeType: file.type, size: file.size })
    if (!validation.ok) {
      setMediaError(validation.error)
      if (documentInputRef.current) documentInputRef.current.value = ''
      return
    }

    let pageCount: number
    try {
      pageCount = await readPdfPageCount(file)
    } catch {
      setMediaError('Choose a valid PDF document.')
      if (documentInputRef.current) documentInputRef.current.value = ''
      return
    }

    if (pageCount > POST_DOCUMENT_MAX_PAGES) {
      setMediaError(`PDF documents can have no more than ${POST_DOCUMENT_MAX_PAGES} pages.`)
      if (documentInputRef.current) documentInputRef.current.value = ''
      return
    }

    await uploadFiles([{ file, pageCount }])
  }

  const publishBody = bodyWithTopicTags(body, topicTags)
  const characterCount = publishBody.length
  const mediaIsReady = media.length > 0 && media.every((item) => item.status === 'ready' && Boolean(item.postId && item.storagePath))
  const mediaBlocksPost = media.some((item) => item.status !== 'ready')
  const mediaManifest = mediaIsReady
    ? JSON.stringify(media.map((item, position) => ({
        postId: item.postId,
        storagePath: item.storagePath,
        mimeType: item.mimeType,
        size: item.size,
        altText: '',
        position,
        fileName: item.file.name,
        pageCount: item.pageCount,
      })))
    : ''
  const canSubmit = body.trim().length > 0 && characterCount <= POST_CHARACTER_LIMIT && !mediaBlocksPost
  const hasDraft = Boolean(body.trim() || topicTags.trim() || media.length || pollFields.some((field) => field.value.trim()))
  const tagPreview = normalizedTopicTags(topicTags)
  const submitLabel = mode === 'question' ? 'Ask Community' : mode === 'poll' ? 'Publish Poll' : 'Post Update'
  const pickerHintClass = 'max-md:bg-ocean-50 max-md:ring-2 max-md:ring-ocean-500'
  const phoneToolButton = 'max-md:size-11 max-md:justify-center max-md:gap-0 max-md:px-0'

  return (
    <>
      <Card className={`border border-mist-100 p-4 ${hideTriggerOnPhones ? 'max-md:hidden' : ''}`}>
        <div className="flex items-center gap-3">
          {postAsOrganization ? <OrganizationAvatar organization={postAsOrganization} size="size-11" /> : <ProfileAvatar profile={profile} size="size-11" />}
          <button type="button" onClick={() => openComposer()} className="min-h-12 min-w-0 flex-1 cursor-pointer truncate rounded-full border border-mist-200 bg-white px-5 text-left text-sm font-medium text-muted transition hover:border-ocean-200 hover:bg-mist-50 hover:text-navy-950">
            {postAsOrganization ? `Start a post as ${postAsOrganization.name}` : 'Start a post'}
          </button>
        </div>
      </Card>

      {open ? (
        // Phones: a full-screen composer (close · Post on top, tools pinned at the bottom). md+: a centred dialog.
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-navy-950/55 px-4 py-8 sm:items-center max-md:overflow-hidden max-md:bg-white max-md:p-0" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer() }}>
          <section role="dialog" aria-modal="true" aria-labelledby="create-post-title" className="w-full max-w-2xl overflow-visible rounded-2xl bg-white shadow-2xl max-md:flex max-md:h-dvh max-md:max-w-none max-md:flex-col max-md:rounded-none max-md:shadow-none">
            <div className="flex items-center justify-between border-b border-mist-100 px-5 py-4 max-md:hidden">
              <div>
                <h2 id="create-post-title" className="text-lg font-semibold text-navy-950">Create a post</h2>
                <p className="mt-0.5 text-xs text-muted">Drafts are saved automatically on this device.</p>
              </div>
              <button type="button" onClick={closeComposer} aria-label="Close post composer" className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-mist-50 hover:text-navy-950"><X aria-hidden="true" className="size-5" /></button>
            </div>

            <form ref={formRef} action={formAction} className="max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col">
              <input type="hidden" name="mode" value={mode === 'poll' ? 'poll' : 'standard'} />
              <input type="hidden" name="category" value={defaultCategory ?? 'technical_discussion'} />
              <input type="hidden" name="companyId" value={postAsOrganization?.id ?? ''} />
              {mediaIsReady ? <input type="hidden" name="mediaManifest" value={mediaManifest} /> : null}

              <div data-testid="composer-phone-bar" className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-mist-100 px-2 pt-[env(safe-area-inset-top)] md:hidden">
                <button type="button" onClick={closeComposer} aria-label="Close composer" className="grid size-11 cursor-pointer place-items-center rounded-full text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500">
                  <X aria-hidden="true" className="size-6" />
                </button>
                <button
                  type="submit"
                  disabled={pending || !canSubmit}
                  className="mr-1 inline-flex min-h-10 cursor-pointer items-center rounded-full bg-ocean-700 px-5 text-[15px] font-semibold text-white transition hover:bg-ocean-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:bg-mist-100 disabled:text-muted"
                >
                  {pending ? 'Posting…' : 'Post'}
                </button>
              </div>

              <div data-testid="composer-scroll" className="max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto">
                {/* Phones (personal posts): photo on the left, name above the audience pill, as in the approved composer. */}
                <div className={`flex flex-wrap items-center gap-3 px-5 pt-4 max-md:gap-x-3 max-md:gap-y-2 max-md:px-4 ${organizations.length ? '' : 'max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)] max-md:gap-y-1 max-md:[&>:first-child]:row-span-2'}`}>
                  {organizations.length ? (
                    <PostAsChooser profile={profile} organizations={organizations} value={postAsOrganization?.id ?? null} onChange={setPostAs} disabled={pending} />
                  ) : (
                    <>
                      <ProfileAvatar profile={profile} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-navy-950">{profile.fullName}</p>
                        <p className="truncate text-xs text-muted">{profile.rank ?? profile.headline ?? 'Maritime professional'}</p>
                      </div>
                    </>
                  )}
                  <label className="text-xs font-semibold text-navy-950 max-md:relative max-md:col-start-2 max-md:flex max-md:items-center max-md:justify-self-start">
                    <span className="max-md:sr-only">Audience</span>
                    <Globe aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-navy-700 md:hidden" />
                    <select aria-label="Audience" value="community" disabled className="ml-2 min-h-9 rounded-full border border-mist-100 bg-mist-50 px-3 text-xs font-semibold text-navy-950 disabled:opacity-100 max-md:ml-0 max-md:border-mist-300 max-md:bg-white max-md:pl-8 max-md:text-[13px]">
                      <option value="community">Sea N Shore community</option>
                    </select>
                  </label>
                </div>

                {organizationsError && !organizations.length ? (
                  <p role="status" className="mx-5 mt-3 max-md:mx-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    We could not load the organizations you post for, so this post will be from you. Close and reopen the composer to try again.
                  </p>
                ) : null}
                {postAsOrganization ? (
                  <p className="mx-5 mt-3 text-xs text-muted max-md:mx-4">
                    Shown as <span className="font-semibold text-navy-900">{postAsOrganization.name}</span> in the feed and on its organization page. Your name stays on record as the author.
                  </p>
                ) : null}

                <div className="mx-5 mt-4 grid grid-cols-3 gap-1 rounded-xl bg-mist-50 p-1 max-md:mx-4 max-md:mt-3 max-md:flex max-md:gap-2 max-md:bg-transparent max-md:p-0" aria-label="Post type">
                  {([
                    ['update', 'Update', PencilLine],
                    ['question', 'Question', MessageCircleQuestion],
                    ['poll', 'Poll', BarChart3],
                  ] as const).map(([value, label, Icon]) => (
                    <button key={value} type="button" onClick={() => chooseMode(value)} aria-pressed={mode === value} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold transition max-md:min-h-9 max-md:rounded-full max-md:border max-md:px-4 max-md:[&>svg]:hidden ${mode === value ? 'bg-white text-navy-950 shadow-sm max-md:border-navy-950 max-md:bg-navy-950 max-md:text-white max-md:shadow-none' : 'text-muted hover:text-navy-950 max-md:border-mist-300 max-md:text-navy-800'}`}>
                      <Icon aria-hidden="true" className="size-4" /> {label}
                    </button>
                  ))}
                </div>

                <div className="min-h-48 px-5 py-4 max-md:mt-3 max-md:min-h-0 max-md:border-t max-md:border-mist-100 max-md:px-4">
                  <label htmlFor="feed-post-body" className="sr-only">Post to Sea N Shore</label>
                  <MentionInput
                    id="feed-post-body"
                    name="body"
                    rows={6}
                    value={body}
                    onChange={setBody}
                    mentions={mentions}
                    onMentionsChange={setMentions}
                    placeholder={mode === 'question' ? 'What would you like to ask the maritime community?' : mode === 'poll' ? 'Introduce your poll or explain the context…' : 'Share an update, insight or lesson with the maritime community…'}
                    className="min-h-40 w-full resize-none border-0 bg-transparent px-0 py-1 text-lg leading-7 text-ink outline-none placeholder:text-muted"
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted">{mode === 'question' ? 'Good questions include enough context for practical answers.' : 'Use @ to mention maritime professionals.'}</p>
                    {/* Phones show the counter in the bottom toolbar. */}
                    <p className={`text-xs font-semibold max-md:hidden ${characterCount > POST_CHARACTER_LIMIT ? 'text-red-700' : 'text-muted'}`} aria-live="polite">{characterCount} / {POST_CHARACTER_LIMIT}</p>
                  </div>
                  {state.fieldErrors?.body ? <p id="feed-body-error" className="mt-1 text-sm text-red-700">{state.fieldErrors.body[0]}</p> : null}
                </div>

                {tagPreview.length ? (
                  <p data-testid="composer-tag-preview" className="mx-4 mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[15px] font-semibold text-ocean-700 md:hidden">
                    {tagPreview.map((tag) => <span key={tag}>#{tag}</span>)}
                  </p>
                ) : null}
                <label className="mx-5 mb-4 block rounded-xl border border-mist-100 bg-mist-50/50 p-3 text-xs font-semibold text-navy-950 max-md:mx-4">
                  Topic tags
                  <input id="feed-post-tags" name="topicTags" value={topicTags} onChange={(event) => setTopicTags(event.target.value)} maxLength={160} placeholder="Safety, SIRE 2.0, Careers" className="mt-1 min-h-10 w-full rounded-lg border border-mist-100 bg-white px-3 text-sm font-medium text-ink outline-none focus:border-ocean-400" />
                  <span className="mt-1 block font-normal text-muted">Up to 5 comma-separated topics. They publish as hashtags.</span>
                </label>

                {mode === 'poll' ? (
                  <fieldset className="mx-5 mb-4 max-md:mx-4 rounded-2xl border border-mist-100 bg-mist-50/50 p-4">
                    <legend className="px-1 text-sm font-semibold text-navy-950">Poll options</legend>
                    <div className="mt-2 space-y-2">
                      {pollFields.map((field, index) => (
                        <div key={field.id} className="flex gap-2">
                          <label className="sr-only" htmlFor={`poll-option-${field.id}`}>Poll option {index + 1}</label>
                          <input id={`poll-option-${field.id}`} name="pollOption" value={field.value} maxLength={120} onChange={(event) => setPollFields((current) => current.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item))} placeholder={`Option ${index + 1}`} className="min-h-11 flex-1 rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink" />
                          {pollFields.length > 2 ? <button type="button" onClick={() => setPollFields((current) => current.filter((item) => item.id !== field.id))} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-navy-900 border border-mist-200 bg-white transition-colors hover:border-ocean-300 hover:bg-mist-50">Remove</button> : null}
                        </div>
                      ))}
                    </div>
                    {state.fieldErrors?.pollOptions ? <p className="mt-2 text-sm text-red-700">{state.fieldErrors.pollOptions[0]}</p> : null}
                    <button type="button" disabled={pollFields.length >= 6} onClick={addPollField} className="mt-3 min-h-10 rounded-xl border border-mist-200 bg-white px-3 text-sm font-semibold text-ocean-700 disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:border-ocean-300 enabled:hover:bg-mist-50 transition-colors">Add option</button>
                  </fieldset>
                ) : null}

                {media.length > 0 && mode !== 'poll' ? (
                  <div className="mx-5 mb-4 overflow-hidden rounded-2xl border border-mist-100 bg-mist-50/40 max-md:mx-4">
                    {media.length === 1 && media[0]?.mimeType === 'application/pdf' ? (
                      <div className="flex items-center gap-3 p-4">
                        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-red-50 text-red-700">
                          <FileText aria-hidden="true" className="size-6" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-navy-950">{media[0].file.name}</p>
                          <p className="text-xs text-muted">{media[0].pageCount ?? 0} pages · {mediaStatus(media[0])}</p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${media[0].file.name}`}
                          disabled={media[0].status === 'requesting' || media[0].status === 'uploading'}
                          onClick={() => removeMedia(media[0].localUrl)}
                          className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-white hover:text-navy-950 disabled:opacity-40"
                        >
                          <X aria-hidden="true" className="size-4" />
                        </button>
                      </div>
                    ) : media.length === 1 && isVideoPostMediaMime(media[0]?.mimeType ?? '') ? (
                      <div>
                        <div className="flex items-center justify-between gap-3 border-b border-mist-100 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-navy-950">{media[0]?.file.name}</p>
                            <p className="text-xs text-muted">{media[0] ? mediaStatus(media[0]) : null}</p>
                          </div>
                          {media[0] ? (
                            <button
                              type="button"
                              aria-label={`Remove ${media[0].file.name}`}
                              disabled={media[0].status === 'requesting' || media[0].status === 'uploading'}
                              onClick={() => removeMedia(media[0].localUrl)}
                              className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-white hover:text-navy-950 disabled:opacity-40"
                            >
                              <X aria-hidden="true" className="size-4" />
                            </button>
                          ) : null}
                        </div>
                        {media[0] ? <video src={media[0].localUrl} controls preload="metadata" className="max-h-[48vh] w-full bg-black object-contain" /> : null}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
                        {media.map((item, index) => (
                          <div key={item.localUrl} className="overflow-hidden rounded-xl border border-mist-100 bg-white">
                            <div className="relative aspect-square overflow-hidden bg-mist-50">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={item.localUrl} alt={`Selected photo ${index + 1} preview`} className="h-full w-full object-cover" />
                              <button
                                type="button"
                                aria-label={`Remove ${item.file.name}`}
                                disabled={item.status === 'requesting' || item.status === 'uploading'}
                                onClick={() => removeMedia(item.localUrl)}
                                className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-white/95 text-navy-950 shadow-sm hover:bg-white disabled:opacity-50"
                              >
                                <X aria-hidden="true" className="size-4" />
                              </button>
                            </div>
                            <div className="px-2.5 py-2">
                              <p className="truncate text-xs font-semibold text-navy-950">{item.file.name}</p>
                              <p className="mt-0.5 truncate text-[11px] text-muted">{mediaStatus(item)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {hasDraft ? (
                  <div className="mx-4 mb-4 md:hidden">
                    <button type="button" onClick={() => resetComposer({ discardMedia: true, clearDraft: true })} className="inline-flex min-h-11 cursor-pointer items-center rounded-full px-3 text-sm font-semibold text-navy-700 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500">
                      Discard draft
                    </button>
                  </div>
                ) : null}
              </div>

              <div data-testid="composer-toolbar" className="flex flex-wrap items-center gap-1 border-t border-mist-100 px-5 py-3 max-md:order-last max-md:shrink-0 max-md:flex-nowrap max-md:px-2 max-md:pb-[calc(0.5rem+env(safe-area-inset-bottom))] max-md:pt-1.5">
                <div className="max-md:order-5">
                  <EmojiPicker onSelect={(emoji) => setBody((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${emoji}`)} />
                </div>

                <input
                  ref={mediaInputRef}
                  id="post-media"
                  type="file"
                  multiple
                  accept={POST_MEDIA_ACCEPT}
                  className="sr-only"
                  disabled={mode === 'poll'}
                  onChange={(event) => void choosePhotoVideo(Array.from(event.target.files ?? []))}
                />
                <label htmlFor="post-media" aria-disabled={mode === 'poll'} data-picker-hint={pickerHint === 'photo' || undefined} className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full px-3 text-sm font-semibold max-md:order-1 ${phoneToolButton} ${pickerHint === 'photo' ? pickerHintClass : ''} ${mode === 'poll' ? 'pointer-events-none text-muted opacity-50' : 'text-navy-900 hover:bg-mist-50'}`}>
                  <ImagePlus aria-hidden="true" className="size-5 text-ocean-700 max-md:size-6 max-md:text-navy-800" />
                  <span className="max-md:sr-only">Photo / Video</span>
                </label>
                <span className="hidden text-xs text-muted sm:inline max-md:!hidden">Up to 10 photos</span>

                <input
                  ref={documentInputRef}
                  id="post-document"
                  type="file"
                  accept={POST_DOCUMENT_ACCEPT}
                  className="sr-only"
                  disabled={mode === 'poll'}
                  onChange={(event) => void chooseDocument(event.target.files?.[0])}
                />
                <label htmlFor="post-document" aria-disabled={mode === 'poll'} data-picker-hint={pickerHint === 'document' || undefined} className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full px-3 text-sm font-semibold max-md:order-2 ${phoneToolButton} ${pickerHint === 'document' ? pickerHintClass : ''} ${mode === 'poll' ? 'pointer-events-none text-muted opacity-50' : 'text-navy-900 hover:bg-mist-50'}`}>
                  <FileText aria-hidden="true" className="size-5 text-ocean-700 max-md:size-6 max-md:text-navy-800" />
                  <span className="max-md:sr-only">Document</span>
                </label>
                <span className="hidden text-xs text-muted lg:inline">PDF · Max 25 MB · 50 pages</span>

                <button type="button" onClick={() => chooseMode('poll')} aria-label="Add a poll" aria-pressed={mode === 'poll'} className={`order-3 grid size-11 cursor-pointer place-items-center rounded-full hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 md:hidden ${mode === 'poll' ? 'bg-ocean-50 text-ocean-700' : 'text-navy-800'}`}>
                  <BarChart3 aria-hidden="true" className="size-6" />
                </button>
                <button type="button" onClick={() => document.getElementById('feed-post-tags')?.focus()} aria-label="Add topic tags" className="order-4 grid size-11 cursor-pointer place-items-center rounded-full text-navy-800 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 md:hidden">
                  <Hash aria-hidden="true" className="size-6" />
                </button>

                <span className="ml-auto text-xs text-muted max-md:hidden">Audience: Sea N Shore community</span>
                <p className={`order-6 ml-auto pr-2 text-[13px] tabular-nums md:hidden ${characterCount > POST_CHARACTER_LIMIT ? 'font-semibold text-red-700' : 'text-muted'}`}>
                  {characterCount}/{POST_CHARACTER_LIMIT}
                </p>
              </div>

              {(mediaError || state.fieldErrors?.media || state.error) ? (
                <div className="space-y-2 border-t border-mist-100 px-5 py-3 max-md:shrink-0 max-md:px-4">
                  {mediaError ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{mediaError}</p> : null}
                  {state.fieldErrors?.media ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.fieldErrors.media[0]}</p> : null}
                  {state.error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist-100 px-5 py-4 max-md:hidden">
                <button type="button" onClick={() => resetComposer({ discardMedia: true, clearDraft: true })} className="min-h-10 rounded-full px-4 text-sm font-semibold text-navy-900 border border-mist-200 bg-white transition-colors hover:border-ocean-300 hover:bg-mist-50">Discard draft</button>
                <button type="submit" disabled={pending || !canSubmit} className="inline-flex min-h-10 items-center rounded-full bg-navy-950 px-6 text-sm font-semibold text-white transition hover:bg-ocean-700 disabled:cursor-not-allowed disabled:bg-mist-100 disabled:text-muted">
                  {pending ? 'Posting…' : submitLabel}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  )
}
