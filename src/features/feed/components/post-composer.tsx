'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { BarChart3, ImagePlus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import type { OwnProfile } from '@/features/profiles/types'
import {
  createPost,
  createPostMediaUpload,
  discardPendingPostMedia,
  type PostComposerState,
} from '../actions'
import {
  isVideoPostMediaMime,
  validatePostMediaMetadata,
  type PostMediaMime,
} from '../media-policy'
import type { PostCategory } from '../types'
import { EmojiPicker } from './emoji-picker'
import { MentionInput, type SelectedMention } from './mention-input'
import { uploadPostMediaFile } from './upload-post-media'

const initialState: PostComposerState = {}
const POST_MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

type PollField = { id: string; value: string }

type ComposerMedia = {
  file: File
  localUrl: string
  postId: string | null
  storagePath: string | null
  mimeType: PostMediaMime
  size: number
  progress: number
  status: 'requesting' | 'uploading' | 'ready' | 'error'
  error?: string
}

function newPollFields(prefix: string, values: string[] = ['', '']): PollField[] {
  const source = values.length >= 2 ? values.slice(0, 6) : ['', '']
  return source.map((value, index) => ({ id: `${prefix}-${index + 1}`, value }))
}

function ProfileAvatar({ profile, size = 'size-12' }: { profile: OwnProfile; size?: string }) {
  return (
    <div className={`grid ${size} shrink-0 place-items-center overflow-hidden rounded-full bg-mist-100 text-sm font-semibold text-navy-950 ring-1 ring-mist-100`}>
      {profile.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatarUrl} alt={`${profile.fullName}'s profile photo`} className="h-full w-full object-cover" />
      ) : initials(profile.fullName)}
    </div>
  )
}

export function PostComposer({ profile, defaultCategory }: { profile: OwnProfile; defaultCategory?: PostCategory }) {
  const router = useRouter()
  const pollIdPrefix = useId()
  const nextPollFieldNumber = useRef(3)
  const formRef = useRef<HTMLFormElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const mediaStateRef = useRef<ComposerMedia | null>(null)
  const uploadSequenceRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<SelectedMention[]>([])
  const [mode, setMode] = useState<'standard' | 'poll'>('standard')
  const [pollFields, setPollFields] = useState<PollField[]>(() => newPollFields(pollIdPrefix))
  const [media, setMediaState] = useState<ComposerMedia | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => document.getElementById('feed-post-body')?.focus(), 0)
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  function setMedia(next: ComposerMedia | null) {
    mediaStateRef.current = next
    setMediaState(next)
  }

  function discardMediaReference(snapshot: ComposerMedia) {
    if (!snapshot.postId || !snapshot.storagePath) return
    void discardPendingPostMedia({ postId: snapshot.postId, storagePath: snapshot.storagePath, mimeType: snapshot.mimeType })
  }

  function clearMedia(options: { discard: boolean }) {
    uploadSequenceRef.current += 1
    const snapshot = mediaStateRef.current
    if (snapshot) {
      URL.revokeObjectURL(snapshot.localUrl)
      if (options.discard) discardMediaReference(snapshot)
    }
    if (mediaInputRef.current) mediaInputRef.current.value = ''
    setMedia(null)
    setMediaError(null)
  }

  function resetComposer(options: { discardMedia: boolean }) {
    if (mediaStateRef.current) clearMedia({ discard: options.discardMedia })
    formRef.current?.reset()
    setBody('')
    setMentions([])
    setMode('standard')
    nextPollFieldNumber.current = 3
    setPollFields(newPollFields(pollIdPrefix))
  }

  function closeComposer() {
    resetComposer({ discardMedia: true })
    setOpen(false)
  }

  const [state, formAction, pending] = useActionState(async (previousState: PostComposerState, formData: FormData) => {
    const nextState = await createPost(previousState, formData)
    if (nextState.ok) {
      resetComposer({ discardMedia: false })
      setOpen(false)
      router.refresh()
    }
    return nextState
  }, initialState)

  function chooseMode(nextMode: 'standard' | 'poll') {
    setMode(nextMode)
    if (nextMode === 'poll' && mediaStateRef.current) clearMedia({ discard: true })
  }

  function addPollField() {
    setPollFields((current) => {
      const id = `${pollIdPrefix}-${nextPollFieldNumber.current}`
      nextPollFieldNumber.current += 1
      return [...current, { id, value: '' }]
    })
  }

  async function chooseMedia(file: File | undefined) {
    if (!file) return
    const validation = validatePostMediaMetadata({ mimeType: file.type, size: file.size })
    if (!validation.ok) {
      setMediaError(validation.error)
      if (mediaInputRef.current) mediaInputRef.current.value = ''
      return
    }
    if (mediaStateRef.current) clearMedia({ discard: true })
    setMediaError(null)
    const sequence = uploadSequenceRef.current + 1
    uploadSequenceRef.current = sequence
    const localUrl = URL.createObjectURL(file)
    const initialMedia: ComposerMedia = {
      file,
      localUrl,
      postId: null,
      storagePath: null,
      mimeType: validation.mimeType,
      size: file.size,
      progress: 0,
      status: 'requesting',
    }
    setMedia(initialMedia)

    const target = await createPostMediaUpload({ mimeType: validation.mimeType, size: file.size })
    if (uploadSequenceRef.current !== sequence) {
      URL.revokeObjectURL(localUrl)
      return
    }
    if (!target.ok) {
      setMedia({ ...initialMedia, status: 'error', error: target.error })
      return
    }

    const uploadingMedia: ComposerMedia = {
      ...initialMedia,
      postId: target.upload.postId,
      storagePath: target.upload.storagePath,
      mimeType: target.upload.mimeType,
      size: target.upload.size,
      status: 'uploading',
    }
    setMedia(uploadingMedia)

    try {
      await uploadPostMediaFile({
        uploadUrl: target.upload.uploadUrl,
        file,
        onProgress: (progress) => {
          if (uploadSequenceRef.current !== sequence) return
          const current = mediaStateRef.current
          if (!current || current.localUrl !== localUrl) return
          setMedia({ ...current, progress })
        },
      })
      if (uploadSequenceRef.current !== sequence) {
        discardMediaReference(uploadingMedia)
        return
      }
      const current = mediaStateRef.current
      if (!current || current.localUrl !== localUrl) return
      setMedia({ ...current, progress: 100, status: 'ready', error: undefined })
    } catch {
      if (uploadSequenceRef.current !== sequence) {
        discardMediaReference(uploadingMedia)
        return
      }
      discardMediaReference(uploadingMedia)
      const current = mediaStateRef.current
      if (!current || current.localUrl !== localUrl) return
      setMedia({ ...current, status: 'error', error: 'We could not upload this media. Please try again.' })
    }
  }

  const mediaIsReady = media?.status === 'ready' && Boolean(media.postId && media.storagePath)
  const mediaBlocksPost = Boolean(media && !mediaIsReady)
  const canSubmit = body.trim().length > 0 && !mediaBlocksPost

  return (
    <>
      <Card className="border border-mist-100 p-4">
        <div className="flex items-center gap-3">
          <ProfileAvatar profile={profile} size="size-11" />
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-12 flex-1 rounded-full border border-mist-200 bg-white px-5 text-left text-sm font-medium text-muted transition hover:bg-mist-50 hover:text-navy-950"
          >
            Start a post
          </button>
        </div>
      </Card>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-navy-950/55 px-4 py-8 sm:items-center" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer() }}>
          <section role="dialog" aria-modal="true" aria-labelledby="create-post-title" className="w-full max-w-2xl overflow-visible rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-mist-100 px-5 py-4">
              <h2 id="create-post-title" className="text-lg font-semibold text-navy-950">Create a post</h2>
              <button type="button" onClick={closeComposer} aria-label="Close post composer" className="grid size-10 place-items-center rounded-full text-muted transition hover:bg-mist-50 hover:text-navy-950">
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>

            <form ref={formRef} action={formAction}>
              <input type="hidden" name="mode" value={mode} />
              <input type="hidden" name="category" value={defaultCategory ?? 'technical_discussion'} />
              {mediaIsReady && media ? (
                <>
                  <input type="hidden" name="mediaPostId" value={media.postId ?? ''} />
                  <input type="hidden" name="mediaStoragePath" value={media.storagePath ?? ''} />
                  <input type="hidden" name="mediaMimeType" value={media.mimeType} />
                  <input type="hidden" name="mediaSize" value={String(media.size)} />
                </>
              ) : null}

              <div className="flex items-center gap-3 px-5 pt-4">
                <ProfileAvatar profile={profile} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-navy-950">{profile.fullName}</p>
                  <p className="truncate text-xs text-muted">{profile.rank ?? profile.headline ?? 'Maritime professional'}</p>
                </div>
              </div>

              <div className="min-h-56 px-5 py-4">
                <label htmlFor="feed-post-body" className="sr-only">Post to Sea N Shore</label>
                <MentionInput
                  id="feed-post-body"
                  name="body"
                  rows={7}
                  value={body}
                  onChange={setBody}
                  mentions={mentions}
                  onMentionsChange={setMentions}
                  placeholder="Share your thoughts ..."
                  className="min-h-48 w-full resize-none border-0 bg-transparent px-0 py-1 text-lg leading-7 text-ink outline-none placeholder:text-muted"
                />
                {state.fieldErrors?.body ? <p id="feed-body-error" className="mt-1 text-sm text-red-700">{state.fieldErrors.body[0]}</p> : null}
              </div>

              {mode === 'poll' ? (
                <fieldset className="mx-5 mb-4 rounded-2xl border border-mist-100 bg-mist-50/50 p-4">
                  <legend className="px-1 text-sm font-semibold text-navy-950">Technical poll options</legend>
                  <div className="mt-2 space-y-2">
                    {pollFields.map((field, index) => (
                      <div key={field.id} className="flex gap-2">
                        <label className="sr-only" htmlFor={`poll-option-${field.id}`}>Poll option {index + 1}</label>
                        <input id={`poll-option-${field.id}`} name="pollOption" value={field.value} maxLength={120} onChange={(event) => setPollFields((current) => current.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item))} placeholder={`Option ${index + 1}`} className="min-h-11 flex-1 rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink" />
                        {pollFields.length > 2 ? <button type="button" onClick={() => setPollFields((current) => current.filter((item) => item.id !== field.id))} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-muted hover:bg-white hover:text-navy-950">Remove</button> : null}
                      </div>
                    ))}
                  </div>
                  {state.fieldErrors?.pollOptions ? <p className="mt-2 text-sm text-red-700">{state.fieldErrors.pollOptions[0]}</p> : null}
                  <button type="button" disabled={pollFields.length >= 6} onClick={addPollField} className="mt-3 min-h-10 rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-ocean-700 disabled:cursor-not-allowed disabled:opacity-50">Add option</button>
                </fieldset>
              ) : null}

              {media && mode === 'standard' ? (
                <div className="mx-5 mb-4 overflow-hidden rounded-2xl border border-mist-100 bg-mist-50/40">
                  <div className="flex items-center justify-between gap-3 border-b border-mist-100 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-navy-950">{media.file.name}</p>
                      <p className="text-xs text-muted">
                        {media.status === 'requesting' ? 'Preparing media…' : null}
                        {media.status === 'uploading' ? `Uploading ${media.progress}%` : null}
                        {media.status === 'ready' ? 'Ready to post' : null}
                        {media.status === 'error' ? media.error : null}
                      </p>
                    </div>
                    <button type="button" aria-label="Remove media" onClick={() => clearMedia({ discard: true })} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-white hover:text-navy-950"><X aria-hidden="true" className="size-4" /></button>
                  </div>
                  {isVideoPostMediaMime(media.mimeType) ? (
                    <div className="grid max-h-[48vh] place-items-center overflow-auto bg-black/[0.03]"><video src={media.localUrl} controls preload="metadata" className="max-h-[48vh] w-full object-contain" /></div>
                  ) : (
                    <div className="w-full overflow-hidden bg-black/[0.03]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={media.localUrl} alt="Selected post media preview" className="max-h-[48vh] w-full object-contain" />
                    </div>
                  )}
                  <label className="block border-t border-mist-100 px-3 py-3 text-sm text-muted">
                    <span className="sr-only">Media description</span>
                    <input name="altText" maxLength={300} placeholder="Optional media description for accessibility" className="min-h-10 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink" />
                  </label>
                </div>
              ) : null}

              <div className="flex items-center gap-1 border-t border-mist-100 px-5 py-3">
                <EmojiPicker onSelect={(emoji) => setBody((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${emoji}`)} />
                <input ref={mediaInputRef} id="post-media" type="file" accept={POST_MEDIA_ACCEPT} className="sr-only" disabled={mode === 'poll'} onChange={(event) => void chooseMedia(event.target.files?.[0])} />
                <label htmlFor="post-media" aria-disabled={mode === 'poll'} className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold ${mode === 'poll' ? 'cursor-not-allowed text-muted opacity-50' : 'cursor-pointer text-navy-900 hover:bg-mist-50'}`}>
                  <ImagePlus aria-hidden="true" className="size-5 text-ocean-700" /> Photo / Video
                </label>
                <button type="button" onClick={() => chooseMode(mode === 'poll' ? 'standard' : 'poll')} className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold ${mode === 'poll' ? 'bg-ocean-50 text-ocean-700' : 'text-navy-900 hover:bg-mist-50'}`}>
                  <BarChart3 aria-hidden="true" className="size-5 text-ocean-700" /> Technical Poll
                </button>
              </div>

              {(mediaError || state.fieldErrors?.media || state.error) ? (
                <div className="space-y-2 border-t border-mist-100 px-5 py-3">
                  {mediaError ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{mediaError}</p> : null}
                  {state.fieldErrors?.media ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.fieldErrors.media[0]}</p> : null}
                  {state.error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
                </div>
              ) : null}

              <div className="flex justify-end border-t border-mist-100 px-5 py-4">
                <button type="submit" disabled={pending || !canSubmit} className="inline-flex min-h-10 items-center rounded-full bg-navy-950 px-6 text-sm font-semibold text-white transition hover:bg-ocean-700 disabled:cursor-not-allowed disabled:bg-mist-100 disabled:text-muted">
                  {pending ? 'Posting…' : 'Post'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  )
}
