'use client'

import { useState, useTransition } from 'react'
import { Award, CheckCircle2, Loader2, Save } from 'lucide-react'
import { saveCourseCertificateSettings } from '../certificate-settings-actions'
import {
  CERTIFICATE_TEMPLATES,
  CERTIFICATE_TEMPLATE_LABELS,
  normaliseSerialPrefix,
  type CertificateTemplate,
  type CourseCertificateSettings,
} from '../certificate-settings'
import { LearningMediaUploadField } from './learning-media-upload-field'

const fieldClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-mist-50'

/** A small drawing of each layout, so trainers can tell them apart without generating a PDF. */
function TemplateSketch({ template }: { template: CertificateTemplate }) {
  const common = 'relative h-16 w-24 overflow-hidden rounded-md bg-white'
  switch (template) {
    case 'classic':
      return <div className={`${common} border-2 border-ocean-700 p-1`}><div className="h-full rounded-sm border border-mist-200"><div className="mx-auto mt-2 h-1 w-10 rounded bg-ocean-700" /><div className="mx-auto mt-2 h-1.5 w-14 rounded bg-navy-950" /><div className="mx-auto mt-1.5 h-1 w-12 rounded bg-mist-200" /></div></div>
    case 'modern':
      return <div className={`${common} flex border border-mist-200`}><div className="h-full w-5 bg-navy-950" /><div className="flex-1 p-1.5"><div className="h-1 w-8 rounded bg-teal-500" /><div className="mt-2 h-2 w-14 rounded bg-navy-950" /><div className="mt-1.5 h-1 w-10 rounded bg-mist-200" /></div></div>
    case 'formal':
      return <div className={`${common} border-2 border-amber-600 p-0.5`}><div className="relative h-full border border-navy-950"><div className="mx-auto mt-2 h-1.5 w-14 rounded bg-navy-950" /><div className="mx-auto mt-1.5 h-1 w-10 rounded bg-mist-200" /><div className="absolute bottom-1 right-1.5 size-3 rounded-full bg-amber-500" /></div></div>
    case 'minimal':
      return <div className={`${common} border border-mist-200 p-2`}><div className="h-1.5 w-12 rounded bg-navy-950" /><div className="mt-1 h-1 w-8 rounded bg-mist-200" /><div className="mt-3 h-px w-full bg-teal-500" /></div>
  }
}

export function CertificateSettingsPanel({
  courseId,
  initial,
  certificateEnabled,
  quizzes,
  readOnly = false,
}: {
  courseId: string
  initial: CourseCertificateSettings
  certificateEnabled: boolean
  quizzes: Array<{ id: string; title: string }>
  readOnly?: boolean
}) {
  const [settings, setSettings] = useState(initial)
  const [validity, setValidity] = useState(initial.validityMonths ? String(initial.validityMonths) : '')
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const set = <K extends keyof CourseCertificateSettings>(key: K, value: CourseCertificateSettings[K]) => setSettings((current) => ({ ...current, [key]: value }))
  const preview = normaliseSerialPrefix(settings.serialPrefix)

  function save() {
    setMessage(null)
    startTransition(async () => {
      const result = await saveCourseCertificateSettings(courseId, {
        ...settings,
        validityMonths: validity.trim() ? Number(validity) : null,
        finalLessonId: settings.issueTrigger === 'final_quiz' ? settings.finalLessonId : null,
      })
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error })
        return
      }
      setSettings(result.settings)
      setMessage({ tone: 'success', text: 'Certificate settings saved. New certificates use them; certificates already issued keep their design.' })
    })
  }

  return (
    <section className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8" aria-label="Certificate">
      <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-700"><Award className="size-4" aria-hidden="true" /> Certificate</p>
      <h2 className="mt-2 text-2xl font-bold text-navy-950">Certificate design and issuing</h2>
      {!certificateEnabled ? (
        <p className="mt-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Certificates are turned off in the course details above. Turn them on there to issue certificates.</p>
      ) : null}

      <fieldset className="mt-5" disabled={readOnly || pending}>
        <legend className="text-sm font-bold text-navy-950">Layout</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CERTIFICATE_TEMPLATES.map((template) => (
            <label key={template} className={`flex cursor-pointer gap-3 rounded-2xl border p-3 transition ${settings.template === template ? 'border-teal-500 bg-teal-50/60 ring-2 ring-teal-100' : 'border-mist-200 hover:border-teal-300'}`}>
              <input type="radio" name={`certificate-template-${courseId}`} value={template} checked={settings.template === template} onChange={() => set('template', template)} className="sr-only" />
              <TemplateSketch template={template} />
              <span className="min-w-0">
                <span className="block text-sm font-bold text-navy-950">{CERTIFICATE_TEMPLATE_LABELS[template].label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">{CERTIFICATE_TEMPLATE_LABELS[template].description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {readOnly ? (
        <p className="mt-5 text-sm text-muted">Logo: {settings.logoPath ? 'uploaded' : 'none'} · Signature: {settings.signaturePath ? 'uploaded' : 'none'}</p>
      ) : <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <LearningMediaUploadField courseId={courseId} kind="certificate_logo" label="Logo (optional)" inputAriaLabel="Certificate logo file" value={settings.logoPath} onChange={(value) => set('logoPath', value)} accept="image/png,image/jpeg" previewType="image" />
        </div>
        <div>
          <LearningMediaUploadField courseId={courseId} kind="certificate_signature" label="Signature image (optional)" inputAriaLabel="Certificate signature file" value={settings.signaturePath} onChange={(value) => set('signaturePath', value)} accept="image/png,image/jpeg" previewType="image" />
        </div>
      </div>}

      <fieldset className="mt-5 grid gap-4 md:grid-cols-2" disabled={readOnly || pending}>
        <label className="text-sm font-semibold text-navy-950">
          Signatory name <span className="font-normal text-muted">(optional)</span>
          <input aria-label="Signatory name" maxLength={120} className={fieldClass} value={settings.signatoryName ?? ''} onChange={(event) => set('signatoryName', event.target.value || null)} />
        </label>
        <label className="text-sm font-semibold text-navy-950">
          Signatory title <span className="font-normal text-muted">(optional)</span>
          <input aria-label="Signatory title" maxLength={120} placeholder="Course director" className={fieldClass} value={settings.signatoryTitle ?? ''} onChange={(event) => set('signatoryTitle', event.target.value || null)} />
        </label>
        <label className="text-sm font-semibold text-navy-950">
          Serial prefix <span className="font-normal text-muted">(optional)</span>
          <input aria-label="Certificate serial prefix" maxLength={40} placeholder="SNS-SIRE-" className={`${fieldClass} font-mono uppercase`} value={settings.serialPrefix ?? ''} onChange={(event) => set('serialPrefix', event.target.value || null)} />
          <span className="mt-1 block text-xs font-normal text-muted">{preview ? `Serials look like ${preview}${new Date().getFullYear()}-1A2B3C4D.` : 'Without a prefix, certificates show the standard Sea N Shore number.'}</span>
        </label>
        <label className="text-sm font-semibold text-navy-950">
          Valid for <span className="font-normal text-muted">(months)</span>
          <input aria-label="Certificate validity in months" type="number" min="1" max="120" step="1" placeholder="No expiry" className={fieldClass} value={validity} onChange={(event) => setValidity(event.target.value)} />
          <span className="mt-1 block text-xs font-normal text-muted">{validity.trim() ? `Learners are reminded 30 and 7 days before it expires.` : 'Leave blank for a certificate that never expires.'}</span>
        </label>
      </fieldset>

      <fieldset className="mt-5" disabled={readOnly || pending}>
        <legend className="text-sm font-bold text-navy-950">Issue the certificate when the learner</legend>
        <div className="mt-2 space-y-2">
          <label className="flex items-start gap-3 rounded-xl border border-mist-200 p-3 text-sm">
            <input type="radio" name={`certificate-trigger-${courseId}`} checked={settings.issueTrigger === 'course_completion'} onChange={() => set('issueTrigger', 'course_completion')} className="mt-1" />
            <span><span className="font-bold text-navy-950">Completes the course</span><span className="block text-muted">Every published material complete.</span></span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-mist-200 p-3 text-sm">
            <input type="radio" name={`certificate-trigger-${courseId}`} checked={settings.issueTrigger === 'final_quiz'} disabled={quizzes.length === 0} onChange={() => set('issueTrigger', 'final_quiz')} className="mt-1" />
            <span className="min-w-0 flex-1">
              <span className="font-bold text-navy-950">Passes the final quiz</span>
              <span className="block text-muted">{quizzes.length ? 'Issued as soon as the chosen quiz is passed (after grading, if it has written answers).' : 'Add a quiz to the curriculum first.'}</span>
              {settings.issueTrigger === 'final_quiz' ? (
                <select aria-label="Final quiz" className={fieldClass} value={settings.finalLessonId ?? ''} onChange={(event) => set('finalLessonId', event.target.value || null)}>
                  <option value="">Choose a quiz</option>
                  {quizzes.map((quiz) => <option key={quiz.id} value={quiz.id}>{quiz.title}</option>)}
                </select>
              ) : null}
            </span>
          </label>
        </div>
      </fieldset>

      {message ? (
        <p className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${message.tone === 'success' ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`} role={message.tone === 'success' ? 'status' : 'alert'}>
          {message.tone === 'success' ? <CheckCircle2 className="mr-1.5 inline size-4" aria-hidden="true" /> : null}{message.text}
        </p>
      ) : null}
      {readOnly ? null : (
        <div className="mt-5 flex justify-end">
          <button type="button" disabled={pending} onClick={save} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-900 disabled:opacity-60">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />} Save certificate settings
          </button>
        </div>
      )}
    </section>
  )
}
