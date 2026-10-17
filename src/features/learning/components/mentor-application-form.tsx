'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { focusFirstFormError } from '@/components/ui/form-error-summary'
import { plainFieldErrors, type PlainFieldErrors } from '@/lib/validation/plain-messages'
import { resubmitMentorApplication, submitMentorApplication } from '../actions'
import { MENTOR_APPLICATION_FIELD_LABELS, mentorApplicationSchema, normalizeListInput, type MentorApplicationInput } from '../mentor-application'

type Props = {
  initialValue: MentorApplicationInput
  applicationId?: string
  reviewNote?: string | null
}

type FormState = {
  name: string
  currentLastRank: string
  yearsExperience: string
  vesselTypes: string
  specialization: string
  certifications: string
  linkedInUrl: string
  shortBio: string
  proposedCourseTopics: string
}

function toFormState(value: MentorApplicationInput): FormState {
  return {
    name: value.name,
    currentLastRank: value.currentLastRank,
    yearsExperience: String(value.yearsExperience),
    vesselTypes: value.vesselTypes.join(', '),
    specialization: value.specialization,
    certifications: value.certifications.join(', '),
    linkedInUrl: value.linkedInUrl ?? '',
    shortBio: value.shortBio,
    proposedCourseTopics: value.proposedCourseTopics.join(', '),
  }
}

function inputClassName(invalid = false) {
  return `mt-2 min-h-12 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none transition placeholder:text-muted focus:ring-2 ${
    invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : 'border-mist-200 focus:border-teal-500 focus:ring-teal-100'
  }`
}

type FieldName = keyof FormState

function FieldError({ errors, name }: { errors: PlainFieldErrors; name: FieldName }) {
  const message = errors[name]?.[0]
  if (!message) return null
  return <span id={`${name}-error`} className="mt-1.5 block text-xs font-medium leading-5 text-red-700">{message}</span>
}

export function MentorApplicationForm({ initialValue, applicationId, reviewNote }: Props) {
  const initial = useMemo(() => toFormState(initialValue), [initialValue])
  const [form, setForm] = useState<FormState>(initial)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; copy: string } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<PlainFieldErrors>({})
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const isResubmission = Boolean(applicationId)

  useEffect(() => {
    if (Object.keys(fieldErrors).length) focusFirstFormError(formRef.current)
  }, [fieldErrors])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    // The message under a field goes once the member edits it; everything else they typed stays.
    setFieldErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  /** Highlight, describe and wire a field to its message. */
  function fieldProps(name: FieldName, hintId?: string) {
    const invalid = Boolean(fieldErrors[name]?.length)
    const describedBy = [invalid ? `${name}-error` : null, hintId].filter(Boolean).join(' ')
    return {
      'aria-invalid': invalid,
      'aria-describedby': describedBy || undefined,
      className: inputClassName(invalid),
    } as const
  }

  function payload(): MentorApplicationInput {
    return {
      name: form.name,
      currentLastRank: form.currentLastRank,
      yearsExperience: Number(form.yearsExperience),
      vesselTypes: normalizeListInput(form.vesselTypes),
      specialization: form.specialization,
      certifications: normalizeListInput(form.certifications),
      linkedInUrl: form.linkedInUrl.trim() || null,
      shortBio: form.shortBio,
      profilePhotoPath: initialValue.profilePhotoPath,
      proposedCourseTopics: normalizeListInput(form.proposedCourseTopics),
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    const input = payload()
    // The same rules as the server, checked first so the member sees each problem under its field.
    const local = mentorApplicationSchema.safeParse(input)
    if (!local.success) {
      setFieldErrors(plainFieldErrors(local.error, MENTOR_APPLICATION_FIELD_LABELS))
      return
    }
    setFieldErrors({})

    startTransition(async () => {
      const result = applicationId
        ? await resubmitMentorApplication(applicationId, input)
        : await submitMentorApplication(input)

      if (!result.ok) {
        if (result.fieldErrors && Object.keys(result.fieldErrors).length) {
          setFieldErrors(result.fieldErrors)
          return
        }
        setMessage({ tone: 'error', copy: result.error })
        return
      }

      setMessage({
        tone: 'success',
        copy: applicationId ? 'Application resubmitted for review.' : 'Application submitted for review.',
      })
    })
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="flex flex-col gap-2 border-b border-mist-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">{isResubmission ? 'Update application' : 'Apply to teach'}</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Share your maritime expertise</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Your Sea N Shore profile starts the application. Add the credentials, teaching focus and course topics that help our review team assess your trainer fit.</p>
        </div>
      </div>

      {reviewNote ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          <p className="font-bold">Review feedback</p>
          <p className="mt-1">{reviewNote}</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-navy-950">Name
          <input aria-label="Name" {...fieldProps('name')} value={form.name} onChange={(event) => update('name', event.target.value)} autoComplete="name" />
          <FieldError errors={fieldErrors} name="name" />
        </label>
        <label className="text-sm font-semibold text-navy-950">Current / last rank
          <input aria-label="Current / last rank" {...fieldProps('currentLastRank')} value={form.currentLastRank} onChange={(event) => update('currentLastRank', event.target.value)} />
          <FieldError errors={fieldErrors} name="currentLastRank" />
        </label>
        <label className="text-sm font-semibold text-navy-950">Years of maritime experience
          <input aria-label="Years of maritime experience" type="number" min="0" max="70" step="0.5" {...fieldProps('yearsExperience')} value={form.yearsExperience} onChange={(event) => update('yearsExperience', event.target.value)} />
          <FieldError errors={fieldErrors} name="yearsExperience" />
        </label>
        <label className="text-sm font-semibold text-navy-950">Vessel types
          <input aria-label="Vessel types" {...fieldProps('vesselTypes', 'vesselTypes-hint')} value={form.vesselTypes} onChange={(event) => update('vesselTypes', event.target.value)} placeholder="Oil Tanker, LNG Carrier" />
          <FieldError errors={fieldErrors} name="vesselTypes" />
          <span id="vesselTypes-hint" className="mt-1.5 block text-xs font-normal text-muted">Separate multiple vessel types with commas.</span>
        </label>
      </div>

      <label className="block text-sm font-semibold text-navy-950">Specialization
        <textarea aria-label="Specialization" {...fieldProps('specialization')} className={`${inputClassName(Boolean(fieldErrors.specialization))} min-h-28 resize-y`} value={form.specialization} onChange={(event) => update('specialization', event.target.value)} placeholder="SIRE 2.0, tanker operations, leadership, maritime law…" />
        <FieldError errors={fieldErrors} name="specialization" />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-navy-950">Certifications
          <textarea aria-label="Certifications" {...fieldProps('certifications', 'certifications-hint')} className={`${inputClassName(Boolean(fieldErrors.certifications))} min-h-24 resize-y`} value={form.certifications} onChange={(event) => update('certifications', event.target.value)} placeholder="Master Unlimited, ISO Lead Auditor" />
          <FieldError errors={fieldErrors} name="certifications" />
          <span id="certifications-hint" className="mt-1.5 block text-xs font-normal text-muted">Separate multiple certifications with commas.</span>
        </label>
        <label className="text-sm font-semibold text-navy-950">LinkedIn profile <span className="font-normal text-muted">(optional)</span>
          <input aria-label="LinkedIn profile" type="url" {...fieldProps('linkedInUrl')} value={form.linkedInUrl} onChange={(event) => update('linkedInUrl', event.target.value)} placeholder="https://www.linkedin.com/in/..." />
          <FieldError errors={fieldErrors} name="linkedInUrl" />
        </label>
      </div>

      <label className="block text-sm font-semibold text-navy-950">Short bio
        <textarea aria-label="Short bio" {...fieldProps('shortBio', 'shortBio-hint')} className={`${inputClassName(Boolean(fieldErrors.shortBio))} min-h-32 resize-y`} value={form.shortBio} onChange={(event) => update('shortBio', event.target.value)} placeholder="Describe your sea/shore experience and the practical knowledge you can teach." />
        <FieldError errors={fieldErrors} name="shortBio" />
        <span id="shortBio-hint" className="mt-1.5 block text-xs font-normal text-muted">40–1,500 characters.</span>
      </label>

      <label className="block text-sm font-semibold text-navy-950">Proposed course topics
        <input aria-label="Proposed course topics" {...fieldProps('proposedCourseTopics', 'proposedCourseTopics-hint')} value={form.proposedCourseTopics} onChange={(event) => update('proposedCourseTopics', event.target.value)} placeholder="SIRE 2.0 readiness, Bridge leadership" />
        <FieldError errors={fieldErrors} name="proposedCourseTopics" />
        <span id="proposedCourseTopics-hint" className="mt-1.5 block text-xs font-normal text-muted">Separate course ideas with commas. You can refine them later in Learning Studio after approval.</span>
      </label>

      {message ? (
        <div role={message.tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${message.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
          {message.tone === 'success' ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          <span>{message.copy}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-mist-100 pt-5">
        <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {pending ? 'Saving…' : isResubmission ? 'Resubmit trainer verification application' : 'Submit trainer verification application'}
        </button>
        <p className="text-xs leading-5 text-muted">Applications are reviewed by Sea N Shore before Learning Studio access is activated.</p>
      </div>
    </form>
  )
}
