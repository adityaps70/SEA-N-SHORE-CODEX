'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, FileText, Send, Upload, X } from 'lucide-react'
import { applyToJob, prepareJobApplicationCvUpload } from '../actions'
import { MAX_JOB_APPLICATION_CV_BYTES } from '../application-media-policy'

export function ApplyJobButton({
  jobId,
  alreadyApplied,
  compact = false,
}: {
  jobId: string
  alreadyApplied: boolean
  compact?: boolean
}) {
  const [submitted, setSubmitted] = useState(alreadyApplied)
  const [open, setOpen] = useState(false)
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  if (submitted) {
    return (
      <div className={compact
        ? 'inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-semibold text-emerald-800'
        : 'inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-50 px-5 text-sm font-semibold text-emerald-800'}
      >
        <CheckCircle2 aria-hidden="true" className="size-4" /> {compact ? 'Applied' : 'Application submitted'}
      </div>
    )
  }

  function chooseCv(file: File | null) {
    setError('')
    if (!file) {
      setCvFile(null)
      return
    }
    if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
      setCvFile(null)
      setError('Please attach your CV as a PDF file.')
      return
    }
    if (file.size < 1 || file.size > MAX_JOB_APPLICATION_CV_BYTES) {
      setCvFile(null)
      setError('Your PDF CV must be 10 MB or smaller.')
      return
    }
    setCvFile(file)
  }

  function submitApplication() {
    setError('')
    startTransition(async () => {
      let cvReference = null

      if (cvFile) {
        const prepared = await prepareJobApplicationCvUpload(jobId, {
          fileName: cvFile.name,
          mimeType: cvFile.type,
          sizeBytes: cvFile.size,
        })
        if (!prepared.ok) {
          setError(prepared.error)
          return
        }

        try {
          const uploadResponse = await fetch(prepared.uploadUrl, {
            method: 'PUT',
            body: cvFile,
            headers: { 'Content-Type': 'application/pdf' },
          })
          if (!uploadResponse.ok) {
            setError('Your CV could not be uploaded. Please try again.')
            return
          }
        } catch {
          setError('Your CV could not be uploaded. Please try again.')
          return
        }

        cvReference = {
          storagePath: prepared.storagePath,
          fileName: prepared.fileName,
          mimeType: prepared.mimeType,
          sizeBytes: prepared.sizeBytes,
        }
      }

      const result = await applyToJob(jobId, cvReference)
      if (result.ok) {
        setSubmitted(true)
        setOpen(false)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError('')
          setOpen(true)
        }}
        className={compact
          ? 'inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900 disabled:cursor-wait disabled:opacity-60'
          : 'inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-navy-900 disabled:cursor-wait disabled:opacity-60'}
      >
        <Send aria-hidden="true" className="size-4" /> {compact ? 'Easy Apply' : 'Apply now'}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-navy-950/45 p-4 backdrop-blur-[2px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Apply for this job"
            className="w-full max-w-lg rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Easy Apply</p>
                <h2 className="mt-1 text-xl font-bold text-navy-950">Submit your application</h2>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Your Sea N Shore maritime profile is included automatically. You can also attach your latest CV.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close application form"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="grid size-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-mist-50 hover:text-navy-950"
              >
                <X aria-hidden="true" className="size-4.5" />
              </button>
            </div>

            <div className="mt-5">
              <label
                htmlFor={`job-cv-${jobId}`}
                className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-mist-200 bg-mist-50 p-4 transition hover:border-ocean-300 hover:bg-white"
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-ocean-700 shadow-sm">
                  <Upload aria-hidden="true" className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-navy-950">Attach CV (PDF)</span>
                  <span className="mt-0.5 block text-xs text-muted">Optional · PDF only · maximum 10 MB</span>
                </div>
              </label>
              <input
                id={`job-cv-${jobId}`}
                aria-label="Attach CV (PDF)"
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={(event) => chooseCv(event.target.files?.[0] ?? null)}
              />

              {cvFile ? (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2.5">
                  <FileText aria-hidden="true" className="size-4 shrink-0 text-emerald-700" />
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-emerald-950">{cvFile.name}</p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setCvFile(null)}
                    className="text-xs font-bold text-emerald-800 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>

            {error ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="min-h-11 rounded-xl border border-mist-100 px-4 text-sm font-bold text-navy-950 hover:bg-mist-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={submitApplication}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white hover:bg-navy-900 disabled:cursor-wait disabled:opacity-60"
              >
                <Send aria-hidden="true" className="size-4" />
                {pending ? 'Submitting…' : 'Submit application'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
