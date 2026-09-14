'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { createCourseDraft, updateCourseDraft } from '../course-actions'
import type { CourseDraftInput } from '../course-repository'

type Props = {
  initialValue: CourseDraftInput
  courseId?: string
}

type FormState = {
  slug: string
  title: string
  subtitle: string
  description: string
  category: string
  level: CourseDraftInput['level']
  language: string
  learningOutcomes: string
  requirements: string
  targetAudience: string
  accessType: CourseDraftInput['accessType']
  price: string
  discountPrice: string
  currency: string
  certificateEnabled: boolean
  courseFormat: CourseDraftInput['courseFormat']
}

const categories = [
  'Deck',
  'Engine',
  'Tankers',
  'LNG/LPG',
  'Offshore',
  'SIRE 2.0',
  'Safety',
  'Maritime Law',
  'Leadership',
  'Human Factors',
  'Shore Careers',
  'Mental Health',
  'Exams & Assessments',
] as const

function toFormState(value: CourseDraftInput): FormState {
  return {
    slug: value.slug,
    title: value.title,
    subtitle: value.subtitle ?? '',
    description: value.description,
    category: value.category,
    level: value.level,
    language: value.language,
    learningOutcomes: value.learningOutcomes.join(', '),
    requirements: value.requirements.join(', '),
    targetAudience: value.targetAudience.join(', '),
    accessType: value.accessType,
    price: String(value.priceMinor / 100),
    discountPrice: value.discountPriceMinor === null ? '' : String(value.discountPriceMinor / 100),
    currency: value.currency,
    certificateEnabled: value.certificateEnabled,
    courseFormat: value.courseFormat,
  }
}

function normalizedList(value: string) {
  const seen = new Set<string>()
  return value.split(',').flatMap((part) => {
    const normalized = part.trim()
    const key = normalized.toLocaleLowerCase('en')
    if (!normalized || seen.has(key)) return []
    seen.add(key)
    return [normalized]
  })
}

function inputClassName() {
  return 'mt-2 min-h-12 w-full rounded-xl border border-mist-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none transition placeholder:text-muted/60 focus:border-teal-500 focus:ring-2 focus:ring-teal-100'
}

function rupeesToMinor(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

export function CourseForm({ initialValue, courseId }: Props) {
  const router = useRouter()
  const initial = useMemo(() => toFormState(initialValue), [initialValue])
  const [form, setForm] = useState<FormState>(initial)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; copy: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const isEditing = Boolean(courseId)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function payload(): CourseDraftInput {
    const isFree = form.accessType === 'free'
    return {
      slug: form.slug,
      title: form.title,
      subtitle: form.subtitle.trim() || null,
      description: form.description,
      category: form.category,
      level: form.level,
      language: form.language,
      thumbnailPath: initialValue.thumbnailPath,
      trailerPath: initialValue.trailerPath,
      learningOutcomes: normalizedList(form.learningOutcomes),
      requirements: normalizedList(form.requirements),
      targetAudience: normalizedList(form.targetAudience),
      accessType: form.accessType,
      priceMinor: isFree ? 0 : rupeesToMinor(form.price),
      discountPriceMinor: isFree || !form.discountPrice.trim() ? null : rupeesToMinor(form.discountPrice),
      currency: form.currency,
      certificateEnabled: form.certificateEnabled,
      courseFormat: form.courseFormat,
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)

    startTransition(async () => {
      if (courseId) {
        const result = await updateCourseDraft(courseId, payload())
        if (!result.ok) {
          setMessage({ tone: 'error', copy: result.error })
          return
        }
        setMessage({ tone: 'success', copy: 'Course changes saved.' })
        return
      }

      const result = await createCourseDraft(payload())
      if (!result.ok) {
        setMessage({ tone: 'error', copy: result.error })
        return
      }
      router.push(`/learn/studio/courses/${result.courseId}/edit`)
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Course identity</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Build a practical maritime learning experience</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">Start with the promise, audience and skill level. Sea N Shore reviews every course before publication.</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-navy-950">Course title
            <input aria-label="Course title" className={inputClassName()} value={form.title} onChange={(event) => update('title', event.target.value)} />
          </label>
          <label className="text-sm font-semibold text-navy-950">Course URL slug
            <input aria-label="Course URL slug" className={inputClassName()} value={form.slug} onChange={(event) => update('slug', event.target.value)} placeholder="sire-2-readiness" />
          </label>
        </div>

        <label className="mt-4 block text-sm font-semibold text-navy-950">Subtitle <span className="font-normal text-muted">(optional)</span>
          <input aria-label="Subtitle" className={inputClassName()} value={form.subtitle} onChange={(event) => update('subtitle', event.target.value)} />
        </label>

        <label className="mt-4 block text-sm font-semibold text-navy-950">Course description
          <textarea aria-label="Course description" className={`${inputClassName()} min-h-36 resize-y`} value={form.description} onChange={(event) => update('description', event.target.value)} />
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-navy-950">Category
            <select aria-label="Category" className={inputClassName()} value={form.category} onChange={(event) => update('category', event.target.value)}>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-navy-950">Level
            <select aria-label="Level" className={inputClassName()} value={form.level} onChange={(event) => update('level', event.target.value as FormState['level'])}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
              <option value="all_levels">All levels</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-navy-950">Course format
            <select aria-label="Course format" className={inputClassName()} value={form.courseFormat} onChange={(event) => update('courseFormat', event.target.value as FormState['courseFormat'])}>
              <option value="recorded">Recorded</option>
              <option value="live_cohort">Live cohort</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-navy-950">Language
            <input aria-label="Language" className={inputClassName()} value={form.language} onChange={(event) => update('language', event.target.value)} />
          </label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Learning design</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <label className="text-sm font-semibold text-navy-950">Learning outcomes
            <textarea aria-label="Learning outcomes" className={`${inputClassName()} min-h-28 resize-y`} value={form.learningOutcomes} onChange={(event) => update('learningOutcomes', event.target.value)} />
            <span className="mt-1.5 block text-xs font-normal text-muted">Separate outcomes with commas.</span>
          </label>
          <label className="text-sm font-semibold text-navy-950">Requirements
            <textarea aria-label="Requirements" className={`${inputClassName()} min-h-28 resize-y`} value={form.requirements} onChange={(event) => update('requirements', event.target.value)} />
            <span className="mt-1.5 block text-xs font-normal text-muted">Separate requirements with commas.</span>
          </label>
          <label className="text-sm font-semibold text-navy-950">Target audience
            <textarea aria-label="Target audience" className={`${inputClassName()} min-h-28 resize-y`} value={form.targetAudience} onChange={(event) => update('targetAudience', event.target.value)} />
            <span className="mt-1.5 block text-xs font-normal text-muted">Separate audience groups with commas.</span>
          </label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Access & recognition</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-navy-950">Access type
            <select aria-label="Access type" className={inputClassName()} value={form.accessType} onChange={(event) => update('accessType', event.target.value as FormState['accessType'])}>
              <option value="free">Free</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          {form.accessType === 'paid' ? (
            <>
              <label className="text-sm font-semibold text-navy-950">Course price (INR)
                <input aria-label="Course price (INR)" type="number" min="0" step="0.01" className={inputClassName()} value={form.price} onChange={(event) => update('price', event.target.value)} />
              </label>
              <label className="text-sm font-semibold text-navy-950">Discount price (INR)
                <input aria-label="Discount price (INR)" type="number" min="0" step="0.01" className={inputClassName()} value={form.discountPrice} onChange={(event) => update('discountPrice', event.target.value)} />
              </label>
              <label className="text-sm font-semibold text-navy-950">Currency
                <input aria-label="Currency" className={inputClassName()} value={form.currency} onChange={(event) => update('currency', event.target.value)} />
              </label>
            </>
          ) : null}
        </div>

        {form.accessType === 'paid' ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">Paid enrollment will activate in the commerce phase. You can define pricing now, but learners will not be charged in Phase 1.</p>
        ) : null}

        <label className="mt-4 inline-flex items-center gap-3 text-sm font-semibold text-navy-950">
          <input aria-label="Certificate enabled" type="checkbox" checked={form.certificateEnabled} onChange={(event) => update('certificateEnabled', event.target.checked)} className="size-4 rounded border-mist-300 text-teal-700" />
          Certificate eligible after completion
        </label>
      </section>

      {message ? (
        <div role="status" className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${message.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
          {message.tone === 'success' ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          <span>{message.copy}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {pending ? 'Saving…' : isEditing ? 'Save course changes' : 'Create draft course'}
        </button>
        <p className="text-xs leading-5 text-muted">Drafts stay private until you submit them for Sea N Shore review.</p>
      </div>
    </form>
  )
}
