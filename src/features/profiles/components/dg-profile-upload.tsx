'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, FileText, ShieldCheck, Upload } from 'lucide-react'
import {
  confirmDgProfileUpload,
  prepareDgProfileUpload,
  removeDgProfileUpload,
} from '../profile-document-actions'
import {
  DG_PROFILE_FILE_ERROR,
  dgProfileDownloadHref,
  formatDocumentSize,
  validateProfileDocumentMetadata,
  type ProfileDocumentSummary,
} from '../profile-document-policy'

const UPLOAD_FAILED = 'Your DG profile could not be uploaded. Check your connection and try again.'

function uploadedLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export function DgProfileOnFileBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800">
      <ShieldCheck aria-hidden="true" className="size-3.5" />
      DG profile on file
    </span>
  )
}

export function DgProfileUpload({
  profileId,
  initialDocument,
  variant,
  onDocumentChange,
}: {
  profileId: string
  initialDocument: ProfileDocumentSummary | null
  variant: 'onboarding' | 'profile'
  onDocumentChange?: (document: ProfileDocumentSummary | null) => void
}) {
  const router = useRouter()
  const inputId = useId()
  const statusId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [doc, setDoc] = useState<ProfileDocumentSummary | null>(initialDocument)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [activity, setActivity] = useState<'upload' | 'remove' | null>(null)
  const [pending, startTransition] = useTransition()
  const busy = pending || activity !== null

  function finish(nextNotice: string) {
    setNotice(nextNotice)
    if (variant === 'profile') router.refresh()
  }

  function chooseFile() {
    inputRef.current?.click()
  }

  function upload(file: File) {
    setError('')
    setNotice('')
    setConfirmingRemove(false)
    const checked = validateProfileDocumentMetadata({ fileName: file.name, mimeType: file.type, sizeBytes: file.size })
    if (!checked.ok) {
      setError(DG_PROFILE_FILE_ERROR)
      return
    }

    setActivity('upload')
    startTransition(async () => {
      try {
        const ticket = await prepareDgProfileUpload({ fileName: file.name, mimeType: file.type, sizeBytes: file.size })
        if (!ticket.ok) {
          setError(ticket.error)
          return
        }

        let uploaded = false
        try {
          const response = await fetch(ticket.uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': 'application/pdf' },
          })
          uploaded = response.ok
        } catch {
          uploaded = false
        }
        if (!uploaded) {
          setError(UPLOAD_FAILED)
          return
        }

        const saved = await confirmDgProfileUpload({
          storagePath: ticket.storagePath,
          fileName: ticket.fileName,
          sizeBytes: ticket.sizeBytes,
        })
        if (!saved.ok) {
          setError(saved.error)
          return
        }
        setDoc(saved.document)
        onDocumentChange?.(saved.document)
        finish(doc ? 'Your DG profile has been replaced.' : 'Your DG profile has been added.')
      } catch {
        setError(UPLOAD_FAILED)
      } finally {
        setActivity(null)
        if (inputRef.current) inputRef.current.value = ''
      }
    })
  }

  function remove() {
    setError('')
    setNotice('')
    setActivity('remove')
    startTransition(async () => {
      try {
        const result = await removeDgProfileUpload()
        if (!result.ok) {
          setError(result.error)
          return
        }
        setDoc(null)
        onDocumentChange?.(null)
        setConfirmingRemove(false)
        finish('Your DG profile has been removed.')
      } catch {
        setError('We could not remove your DG profile. Please try again.')
      } finally {
        setActivity(null)
      }
    })
  }

  const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
  const secondaryButton = `${buttonClass} border border-mist-100 bg-white text-navy-950 hover:border-ocean-500`
  const chooseLabel = doc ? 'Replace PDF' : 'Add DG profile PDF'
  const uploadedOn = doc ? uploadedLabel(doc.uploadedAt) : null

  return (
    <div className="grid min-w-0 gap-3" data-testid="dg-profile-upload">
      {/* No `name`: the PDF goes straight to private storage, never through the onboarding form submission. */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        tabIndex={-1}
        aria-label={chooseLabel}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) upload(file)
        }}
      />

      {doc ? (
        <div className="rounded-2xl border border-mist-100 bg-white p-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist-50 text-ocean-700">
              <FileText aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DgProfileOnFileBadge />
              {/* overflow-wrap:anywhere so DG portal names like DG_Shipping_Profile_…_2026-09-20.pdf wrap instead of widening the card. */}
              <p className="mt-2 text-sm font-semibold text-navy-950 [overflow-wrap:anywhere]">{doc.fileName}</p>
              <p className="mt-0.5 text-xs text-muted">
                {formatDocumentSize(doc.sizeBytes)} · PDF{uploadedOn ? ` · Added ${uploadedOn}` : ''}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={dgProfileDownloadHref(profileId)} target="_blank" rel="noreferrer" className={secondaryButton}>
              View PDF
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
            <button type="button" onClick={chooseFile} disabled={busy} aria-describedby={statusId} className={secondaryButton}>
              <Upload aria-hidden="true" className="size-4" />
              {activity === 'upload' ? 'Uploading…' : chooseLabel}
            </button>
            {!confirmingRemove ? (
              <button type="button" onClick={() => setConfirmingRemove(true)} disabled={busy} className={`${buttonClass} text-red-700 hover:bg-red-50`}>
                Remove
              </button>
            ) : null}
          </div>
          {confirmingRemove ? (
            <div
              role="group"
              aria-label="Confirm removing your DG profile"
              className="mt-3 rounded-xl border border-red-100 bg-red-50 p-3"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setConfirmingRemove(false)
              }}
            >
              <p className="text-sm text-red-800">Remove your DG profile? Employers will no longer be able to open it.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={remove} disabled={busy} className={`${buttonClass} bg-red-700 text-white hover:bg-red-800`}>
                  {activity === 'remove' ? 'Removing…' : 'Remove DG profile'}
                </button>
                <button type="button" onClick={() => setConfirmingRemove(false)} disabled={busy} className={secondaryButton} autoFocus>
                  Keep it
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={chooseFile} disabled={busy} aria-describedby={statusId} className={`${secondaryButton} border-dashed`}>
            <Upload aria-hidden="true" className="size-4" />
            {activity === 'upload' ? 'Uploading…' : chooseLabel}
          </button>
          <span className="text-xs text-muted">PDF only, up to 10 MB.</span>
        </div>
      )}

      <p id={statusId} aria-live="polite" className="text-sm">
        {error ? <span role="alert" className="font-medium text-red-700">{error}</span> : null}
        {!error && activity === 'upload' ? <span className="text-muted">Uploading your DG profile…</span> : null}
        {!error && !activity && notice ? <span className="font-medium text-emerald-700">{notice}</span> : null}
      </p>
    </div>
  )
}
