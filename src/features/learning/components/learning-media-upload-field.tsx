'use client'
/* eslint-disable @next/next/no-img-element -- Upload previews may be blob: URLs or short-lived signed S3 URLs, which are not appropriate for next/image. */

import { useEffect, useRef, useState } from 'react'
import { FileUp, ImageIcon, Loader2, PlayCircle, Trash2, UploadCloud } from 'lucide-react'
import {
  createLearningMediaUpload,
  discardLearningMediaUpload,
  getLearningMediaReadUrl,
} from '../media-actions'
import {
  learningMediaLimitLabel,
  type LearningMediaKind,
} from '../media-policy'
import { uploadLearningMediaFile } from './upload-learning-media'

type Props = {
  courseId: string
  kind: LearningMediaKind
  label: string
  inputAriaLabel: string
  value: string | null
  onChange: (storagePath: string | null) => void
  accept: string
  previewType: 'image' | 'video' | 'file'
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}

export function LearningMediaUploadField({
  courseId,
  kind,
  label,
  inputAriaLabel,
  value,
  onChange,
  accept,
  previewType,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const localPreviewRef = useRef<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function revokeLocalPreview() {
    if (!localPreviewRef.current) return
    URL.revokeObjectURL(localPreviewRef.current)
    localPreviewRef.current = null
  }

  useEffect(() => () => revokeLocalPreview(), [])

  useEffect(() => {
    if (!value) {
      if (!localPreviewRef.current) setPreviewUrl(null)
      return
    }
    if (previewType === 'file') {
      setPreviewUrl(null)
      return
    }
    if (value === pendingPath && localPreviewRef.current) return

    let cancelled = false
    void (async () => {
      const result = await getLearningMediaReadUrl({ courseId, kind, storagePath: value })
      if (cancelled) return
      if (result.ok) {
        setPreviewUrl(result.url)
        setError(null)
      } else {
        setPreviewUrl(null)
        setError(result.error)
      }
    })()
    return () => { cancelled = true }
  }, [courseId, kind, pendingPath, previewType, value])

  async function discardPending(storagePath: string | null) {
    if (!storagePath) return
    try {
      await discardLearningMediaUpload({ courseId, kind, storagePath })
    } catch {
      // Best-effort cleanup. The server independently prevents deletion of referenced media.
    }
  }

  async function uploadFile(file: File) {
    if (uploading) return
    setError(null)
    setProgress(0)
    setUploading(true)

    let preparedPath: string | null = null
    const previousPendingPath = pendingPath
    try {
      const prepared = await createLearningMediaUpload({
        courseId,
        kind,
        mimeType: file.type,
        size: file.size,
      })
      if (!prepared.ok) {
        setError(prepared.error)
        setProgress(null)
        return
      }

      preparedPath = prepared.upload.storagePath
      await uploadLearningMediaFile({
        uploadUrl: prepared.upload.uploadUrl,
        file,
        onProgress: setProgress,
      })

      revokeLocalPreview()
      if (previewType !== 'file') {
        const localPreview = URL.createObjectURL(file)
        localPreviewRef.current = localPreview
        setPreviewUrl(localPreview)
      } else {
        setPreviewUrl(null)
      }
      setPendingPath(prepared.upload.storagePath)
      setFileName(file.name)
      setFileSize(file.size)
      onChange(prepared.upload.storagePath)

      if (previousPendingPath && previousPendingPath !== prepared.upload.storagePath) {
        await discardPending(previousPendingPath)
      }
    } catch {
      if (preparedPath) await discardPending(preparedPath)
      setError('Upload failed. Check your connection and try again.')
      setProgress(null)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function removeCurrent() {
    if (uploading) return
    setError(null)
    if (value && pendingPath === value) await discardPending(value)
    revokeLocalPreview()
    setPreviewUrl(null)
    setPendingPath(null)
    setFileName(null)
    setFileSize(null)
    setProgress(null)
    onChange(null)
  }

  const UploadIcon = previewType === 'image' ? ImageIcon : previewType === 'video' ? PlayCircle : FileUp

  return (
    <div className="rounded-2xl border border-mist-200 bg-mist-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-navy-950">{label}</p>
          <p className="mt-1 text-xs leading-5 text-muted">{learningMediaLimitLabel(kind)}</p>
        </div>
        {value ? (
          <button
            type="button"
            disabled={uploading}
            onClick={() => void removeCurrent()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" aria-hidden="true" /> Remove
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        aria-label={inputAriaLabel}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void uploadFile(file)
        }}
      />

      {previewUrl ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-mist-200 bg-white">
          {previewType === 'image' ? (
            <img src={previewUrl} alt={`${label} preview`} className="aspect-video w-full object-cover" />
          ) : (
            <video src={previewUrl} controls preload="metadata" className="aspect-video w-full bg-black object-contain" />
          )}
        </div>
      ) : null}

      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); if (!uploading) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files?.[0]
          if (file) void uploadFile(file)
        }}
        className={`mt-4 flex min-h-28 w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition ${dragging ? 'border-teal-500 bg-teal-50' : 'border-mist-300 bg-white hover:border-teal-400 hover:bg-teal-50/30'} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {uploading ? <Loader2 className="size-6 animate-spin text-teal-700" aria-hidden="true" /> : value ? <UploadIcon className="size-6 text-teal-700" aria-hidden="true" /> : <UploadCloud className="size-6 text-teal-700" aria-hidden="true" />}
        <span className="mt-2 text-sm font-bold text-navy-950">{uploading ? 'Uploading…' : value ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}</span>
        <span className="mt-1 text-xs text-muted">Choose a file or drag and drop it here.</span>
      </button>

      {progress !== null ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3 text-xs text-muted">
            <span className="truncate">{fileName ?? 'Uploading media'}</span>
            <span>{fileSize !== null ? `${formatBytes(fileSize)} · ` : ''}{progress}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-mist-200">
            <div className="h-full rounded-full bg-teal-600 transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : fileName ? (
        <p className="mt-3 text-xs text-muted">{fileName}{fileSize !== null ? ` · ${formatBytes(fileSize)}` : ''}</p>
      ) : value ? (
        <p className="mt-3 text-xs text-muted">Material attached. Save the material to persist this change.</p>
      ) : null}

      {error ? <p role="alert" className="mt-3 text-xs font-semibold text-rose-700">{error}</p> : null}
    </div>
  )
}
