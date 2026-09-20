'use client'

import {
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Paperclip,
  SendHorizontal,
  X,
} from 'lucide-react'
import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  createMessageAttachmentUploadAction,
  discardMessageAttachmentAction,
  sendMessageAction,
} from '../actions'
import { validateMessageAttachmentMetadata } from '../media-policy'
import type { MessagingMessageDto } from '../queries'
import { MessageEmojiPicker } from './message-emoji-picker'
import { uploadMessageAttachmentFile } from './upload-message-attachment'

export type OptimisticMessagingMessage = MessagingMessageDto & {
  deliveryState: 'sending' | 'failed'
  error?: string
}

type PendingAttachment = {
  storagePath: string
  name: string
  mimeType: string
  size: number
  kind: 'image' | 'video' | 'file'
  progress: number
  status: 'uploading' | 'ready' | 'failed'
  previewUrl: string | null
  error?: string
}

type MessageComposerProps = {
  conversationId: string
  viewerId: string
  replyTo?: MessagingMessageDto | null
  onCancelReply?: () => void
  onOptimisticMessage: (message: OptimisticMessagingMessage) => void
  onMessageConfirmed: (clientMessageId: string, message: MessagingMessageDto) => void
  onMessageFailed: (clientMessageId: string, error: string) => void
}

function optimisticReplyPreview(replyTo: MessagingMessageDto | null | undefined) {
  if (!replyTo) return null
  return {
    messageId: replyTo.id,
    senderProfileId: replyTo.senderProfileId,
    body: replyTo.body,
    attachmentName: replyTo.attachment?.name ?? null,
    deleted: Boolean(replyTo.deletedAt),
  }
}

function attachmentAccept() {
  return [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/zip',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
  ].join(',')
}

export function MessageComposer({
  conversationId,
  viewerId,
  replyTo = null,
  onCancelReply,
  onOptimisticMessage,
  onMessageConfirmed,
  onMessageFailed,
}: MessageComposerProps) {
  const [body, setBody] = useState('')
  const [sendingCount, setSendingCount] = useState(0)
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const [composerError, setComposerError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function discardAttachment(current: PendingAttachment | null = attachment) {
    if (!current) return
    if (current.previewUrl) URL.revokeObjectURL(current.previewUrl)
    setAttachment(null)
    setComposerError('')

    if (current.storagePath) {
      await discardMessageAttachmentAction({
        conversationId,
        storagePath: current.storagePath,
        name: current.name,
        mimeType: current.mimeType,
        size: current.size,
      }).catch(() => undefined)
    }
  }

  async function prepareAttachment(file: File) {
    setComposerError('')
    const validated = validateMessageAttachmentMetadata({
      name: file.name,
      mimeType: file.type,
      size: file.size,
    })
    if (!validated.ok) {
      setComposerError(validated.error)
      return
    }

    if (attachment) await discardAttachment(attachment)

    const previewUrl = validated.kind === 'image' || validated.kind === 'video'
      ? URL.createObjectURL(file)
      : null

    const uploadResult = await createMessageAttachmentUploadAction({
      conversationId,
      name: validated.name,
      mimeType: validated.mimeType,
      size: file.size,
    })

    if (!uploadResult.ok) {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setComposerError(uploadResult.error)
      return
    }

    const prepared: PendingAttachment = {
      storagePath: uploadResult.upload.storagePath,
      name: uploadResult.upload.name,
      mimeType: uploadResult.upload.mimeType,
      size: uploadResult.upload.size,
      kind: uploadResult.upload.kind,
      progress: 0,
      status: 'uploading',
      previewUrl,
    }
    setAttachment(prepared)

    try {
      await uploadMessageAttachmentFile({
        uploadUrl: uploadResult.upload.uploadUrl,
        file,
        onProgress: (progress) => {
          setAttachment((current) => current?.storagePath === prepared.storagePath
            ? { ...current, progress }
            : current)
        },
      })
      setAttachment((current) => current?.storagePath === prepared.storagePath
        ? { ...current, progress: 100, status: 'ready' }
        : current)
    } catch {
      setAttachment((current) => current?.storagePath === prepared.storagePath
        ? {
            ...current,
            status: 'failed',
            error: 'Upload failed. Remove this file and try again.',
          }
        : current)
      setComposerError('Upload failed. Remove this file and try again.')
    }
  }

  function onAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void prepareAttachment(file)
  }

  async function submitMessage() {
    const normalized = body.trim()
    const readyAttachment = attachment?.status === 'ready' ? attachment : null
    if (!normalized && !readyAttachment) return

    const clientMessageId = crypto.randomUUID()
    const optimistic: OptimisticMessagingMessage = {
      id: clientMessageId,
      conversationId,
      senderProfileId: viewerId,
      clientMessageId,
      body: normalized,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      replyTo: optimisticReplyPreview(replyTo),
      attachment: readyAttachment
        ? {
            name: readyAttachment.name,
            mimeType: readyAttachment.mimeType,
            size: readyAttachment.size,
            kind: readyAttachment.kind,
            url: readyAttachment.previewUrl ?? '',
          }
        : null,
      reactions: [],
      deliveryState: 'sending',
    }

    const attachmentInput = readyAttachment
      ? {
          storagePath: readyAttachment.storagePath,
          name: readyAttachment.name,
          mimeType: readyAttachment.mimeType,
          size: readyAttachment.size,
        }
      : undefined

    onOptimisticMessage(optimistic)
    setBody('')
    setAttachment(null)
    setComposerError('')
    onCancelReply?.()
    setSendingCount((count) => count + 1)

    try {
      const result = await sendMessageAction({
        conversationId,
        clientMessageId,
        body: normalized,
        ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
        ...(attachmentInput ? { attachment: attachmentInput } : {}),
      })
      if (result.ok) {
        onMessageConfirmed(clientMessageId, result.message)
        if (readyAttachment?.previewUrl) URL.revokeObjectURL(readyAttachment.previewUrl)
      } else {
        onMessageFailed(clientMessageId, result.error)
      }
    } catch {
      onMessageFailed(clientMessageId, 'Unable to send right now.')
    } finally {
      setSendingCount((count) => Math.max(0, count - 1))
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submitMessage()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitMessage()
    }
  }

  const attachmentReady = attachment?.status === 'ready'
  const canSend = Boolean(body.trim() || attachmentReady)

  return (
    <form onSubmit={onSubmit} className="border-t border-mist-100 bg-white p-3 sm:p-4">
      {replyTo ? (
        <div className="mb-2 flex items-start gap-3 rounded-2xl border-l-4 border-ocean-500 bg-ocean-50 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ocean-700">Replying to message</p>
            <p className="mt-0.5 truncate text-xs text-navy-900">
              {replyTo.body || replyTo.attachment?.name || 'Attachment'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={onCancelReply}
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-white hover:text-navy-950"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}

      {attachment ? (
        <div className="mb-2 overflow-hidden rounded-2xl border border-mist-100 bg-mist-50">
          <div className="flex items-center gap-3 p-2.5">
            {attachment.kind === 'image' && attachment.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL before signed canonical URL exists
              <img src={attachment.previewUrl} alt="" className="size-14 rounded-xl object-cover" />
            ) : attachment.kind === 'video' && attachment.previewUrl ? (
              <video src={attachment.previewUrl} muted className="size-14 rounded-xl object-cover" />
            ) : (
              <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-white text-ocean-700 ring-1 ring-mist-100">
                <FileText aria-hidden="true" className="size-6" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-navy-950">{attachment.name}</p>
              <p className="mt-0.5 text-xs text-muted">
                {attachment.status === 'uploading'
                  ? `Uploading · ${attachment.progress}%`
                  : attachment.status === 'ready'
                    ? 'Ready to send'
                    : attachment.error ?? 'Upload failed'}
              </p>
              {attachment.status === 'uploading' ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist-100">
                  <div
                    className="h-full rounded-full bg-ocean-600 transition-[width]"
                    style={{ width: `${attachment.progress}%` }}
                  />
                </div>
              ) : null}
            </div>

            <button
              type="button"
              aria-label="Remove attachment"
              onClick={() => void discardAttachment()}
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-white hover:text-red-700"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-end gap-1 rounded-2xl border border-mist-100 bg-mist-50 p-2 transition focus-within:border-teal-500">
        <input
          ref={fileInputRef}
          type="file"
          tabIndex={-1}
          className="sr-only"
          accept={attachmentAccept()}
          onChange={onAttachmentChange}
        />
        <button
          type="button"
          aria-label="Attach photo or file"
          title="Attach photo or file"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachment?.status === 'uploading'}
          className="grid size-10 shrink-0 place-items-center rounded-full text-ocean-700 transition hover:bg-white disabled:opacity-40"
        >
          {attachment?.status === 'uploading'
            ? <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
            : <Paperclip aria-hidden="true" className="size-5" />}
        </button>

        <button
          type="button"
          aria-label="Attach photo"
          title="Attach photo"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachment?.status === 'uploading'}
          className="hidden size-10 shrink-0 place-items-center rounded-full text-ocean-700 transition hover:bg-white disabled:opacity-40 sm:grid"
        >
          <ImageIcon aria-hidden="true" className="size-5" />
        </button>

        <MessageEmojiPicker onSelect={(emoji) => {
          if (!emoji) return
          setBody((current) => `${current}${emoji}`)
        }} />

        <label htmlFor="message-composer" className="sr-only">Write a message</label>
        <textarea
          id="message-composer"
          aria-label="Write a message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={5000}
          placeholder="Message…"
          className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-5 text-navy-950 outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          aria-label="Send message"
          title={sendingCount > 0 ? 'Sending message' : 'Send message'}
          disabled={!canSend || attachment?.status === 'uploading'}
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-ocean-700 text-white transition hover:bg-ocean-800 disabled:cursor-not-allowed disabled:bg-mist-100 disabled:text-muted"
        >
          <SendHorizontal aria-hidden="true" className="size-4.5" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 px-1">
        <p className="text-[11px] text-muted">Enter to send · Shift + Enter for a new line</p>
        {composerError ? <p role="alert" className="text-right text-[11px] font-medium text-red-700">{composerError}</p> : null}
      </div>
    </form>
  )
}
