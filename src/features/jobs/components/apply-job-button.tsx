'use client'

import Link from 'next/link'
import { useEffect, useId, useState, useTransition } from 'react'
import { CheckCircle2, FileText, Send, Upload, X, Zap } from 'lucide-react'
import { applyToJob, prepareJobApplicationCvUpload } from '../actions'
import type { ApplyGate } from '../apply-gate'
import { MAX_JOB_APPLICATION_CV_BYTES } from '../application-media-policy'
import { ApplyGateNotice } from './apply-gate-notice'

export function ApplyJobButton({
  jobId,
  alreadyApplied,
  compact = false,
  variant,
  label,
  gate,
}: {
  jobId: string
  alreadyApplied: boolean
  /** Round 12: whether the member may apply (minimum match, profile type, missing profile items). */
  gate?: ApplyGate
  compact?: boolean
  /** 'bar' is the filled pill in the phone sticky apply bar. */
  variant?: 'bar'
  /** Overrides the trigger label (e.g. "Apply now" in the phone bar for non-Easy-Apply jobs). */
  label?: string
}) {
  const bar = variant === 'bar'
  const [submitted, setSubmitted] = useState(alreadyApplied)
  const [open, setOpen] = useState(false)
  const [cvFile, setCvFile] = useState<File | null>(null)
  const [coverNote, setCoverNote] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [refusedGate, setRefusedGate] = useState<ApplyGate | null>(null)
  const coverNoteId = useId()
  // The server's answer wins over the gate the page was rendered with.
  const currentGate = refusedGate ?? gate ?? { status: 'open' as const }

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, pending])

  if (submitted) {
    return (
      <div className={bar
        ? 'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-mist-50 px-5 text-[15px] font-semibold text-navy-900'
        : compact
        ? 'inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-semibold text-emerald-800'
        : 'inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-50 px-5 text-sm font-semibold text-emerald-800'}
      >
        <CheckCircle2 aria-hidden="true" className="size-4" /> {compact || bar ? 'Applied' : 'Application submitted'}
      </div>
    )
  }

  if (currentGate.status !== 'open') {
    if (!compact && !bar) return <ApplyGateNotice gate={currentGate} className="w-full" />
    const pillClass = bar
      ? 'inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-4 text-center text-[13px] font-semibold leading-tight'
      : 'inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold'
    if (currentGate.status === 'incomplete') {
      return (
        <Link href={currentGate.gaps[0]?.href ?? '/profile'} className={`${pillClass} bg-amber-50 text-amber-900 hover:bg-amber-100`}>
          {currentGate.message}
        </Link>
      )
    }
    if (currentGate.status === 'sea_job_profile_type') {
      return (
        <Link href={currentGate.href} title={currentGate.message} className={`${pillClass} bg-amber-50 text-amber-900 hover:bg-amber-100`}>
          {bar ? 'For seafarers · update profile type' : 'For seafarers'}
        </Link>
      )
    }
    return (
      <button type="button" disabled title={currentGate.message} className={`${pillClass} cursor-not-allowed bg-mist-50 text-muted`}>
        {bar ? currentGate.message : `Below minimum (${currentGate.minimum}%)`}
      </button>
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
          if (prepared.gate) {
            setRefusedGate(prepared.gate)
            setOpen(false)
          }
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

      const result = await applyToJob(jobId, cvReference, coverNote.trim() || null)
      if (result.ok) {
        setSubmitted(true)
        setOpen(false)
      } else {
        setError(result.error)
        if (result.gate) {
          setRefusedGate(result.gate)
          setOpen(false)
        }
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
        className={bar
          ? 'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-ocean-700 px-5 text-[15px] font-semibold text-white hover:bg-ocean-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-wait disabled:opacity-60'
          : compact
          ? 'inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900 disabled:cursor-wait disabled:opacity-60'
          : 'inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-navy-900 disabled:cursor-wait disabled:opacity-60'}
      >
        {bar ? <Zap aria-hidden="true" className="size-4" /> : <Send aria-hidden="true" className="size-4" />} {label ?? (compact || bar ? 'Easy Apply' : 'Apply now')}
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

            <div className="mt-4">
              <label htmlFor={coverNoteId} className="block text-sm font-bold text-navy-950">
                Message to the employer <span className="font-medium text-muted">(optional)</span>
              </label>
              <textarea
                id={coverNoteId}
                value={coverNote}
                disabled={pending}
                maxLength={2000}
                rows={3}
                onChange={(event) => setCoverNote(event.target.value)}
                placeholder="For example: your availability, current contract end date, or why this role fits you."
                className="mt-2 w-full rounded-xl border border-mist-200 bg-white px-3 py-2.5 text-sm text-navy-950 outline-none transition focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100"
              />
              <p className="mt-1 text-right text-xs text-muted">{coverNote.length}/2000</p>
            </div>

            {error ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="min-h-11 rounded-xl border border-mist-200 px-4 text-sm font-bold text-navy-950 hover:bg-mist-50"
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
