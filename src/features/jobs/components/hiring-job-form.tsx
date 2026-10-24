'use client'

import Link from '@/components/navigation/intent-link'
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { createHiringJob, updateHiringJob, type HiringActionFailure, type HiringJobSaveIntent } from '../hiring-actions'
import type { HiringEditableJob, HiringJobInput, HiringJobUpdateInput } from '../hiring-repository'
import type { HiringPublisherOption } from '../publishers'
import { AcceptedRolesPicker, type AcceptedRolesValue } from '@/features/roles/components/accepted-roles-picker'
import { DEFAULT_MIN_MATCH_TO_APPLY } from '@/features/roles/job-role-input'
import { domainForDepartment, normaliseLegacyRank, roleByKey } from '@/features/roles/taxonomy'
import {
  JOB_DESCRIPTION_MIN_LENGTH,
  JOB_FORM_FIELD_ORDER,
  JOB_TITLE_MAX_LENGTH,
  jobDraftTitle,
  thingsToFix,
  validateJobDraft,
  validateJobPublish,
  type JobFormField,
  type JobFormIssue,
  type JobFormValidation,
} from '../job-form-rules'
import { todayIsoDate } from '../job-lifecycle'
import { FORM_FIELD_SCROLL_MARGIN_CLASS, FormIssueSummary, focusFormField } from '@/components/ui/form-issue-summary'
import { formDraftStorageKey, useFormAutosave, type StoredFormDraft } from '@/hooks/use-form-autosave'
import { useUnsavedChangesWarning } from '@/hooks/use-unsaved-changes-warning'
import { formDataFromSnapshot } from '@/lib/forms/form-snapshot'
import { CONNECTION_LOST_MESSAGE, goToSignInAgain, hasSessionEnded } from '@/lib/forms/session-check'

type HiringJobFormProps = (
  | { mode: 'create'; publisherOptions: HiringPublisherOption[]; initial?: never; jobId?: never; publishLabel?: never; notice?: never }
  | {
      mode: 'edit'
      jobId: string
      initial: HiringEditableJob
      publisherOptions?: never
      /** "Save and publish" for drafts, "Save and republish" for archived jobs, null when not allowed. */
      publishLabel?: string | null
      /** 'draft': just saved as a draft from Post a job. */
      notice?: 'draft' | null
    }
) & {
  /** Hotfix P2: the member the local autosave copy belongs to; without it there is no local copy. */
  draftOwnerId?: string | null
}

const inputClass = 'min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-navy-950 outline-none transition placeholder:text-muted focus:border-navy-300 focus:ring-2 focus:ring-navy-100 aria-[invalid=true]:border-red-400'
const labelClass = 'space-y-1.5 text-sm font-semibold text-navy-900'

const FIELD_LABELS: Record<JobFormField, string> = {
  title: 'Job title',
  departmentKey: 'Department',
  acceptedRoleKeys: 'Accepted ranks / roles',
  roleOtherText: 'Other rank / role',
  location: 'Location',
  summary: 'Summary',
  description: 'Description',
  experienceMinYears: 'Minimum years',
  experienceMaxYears: 'Maximum years',
  regions: 'Sailing regions',
  joiningFrom: 'Joining date',
  applyUntil: 'Last date to apply',
  salaryMax: 'Salary maximum',
}

const fieldId = (field: JobFormField) => `hiring-job-${field}`

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
}

function nullableText(formData: FormData, key: string) {
  const value = text(formData, key)
  return value || null
}

function nullableNumber(formData: FormData, key: string) {
  const value = text(formData, key)
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function csv(formData: FormData, key: string) {
  return [...new Set(text(formData, key).split(',').map((item) => item.trim()).filter(Boolean))]
}

function buildInput(formData: FormData): HiringJobUpdateInput {
  const domainValue = text(formData, 'domain')
  const salaryPeriodValue = text(formData, 'salaryPeriod')
  const minMatch = nullableNumber(formData, 'minMatchToApply')

  return {
    departmentKey: nullableText(formData, 'departmentKey'),
    acceptedRoleKeys: formData.getAll('acceptedRoleKeys').map(String),
    roleOtherText: nullableText(formData, 'roleOtherText'),
    minMatchToApply: minMatch ?? DEFAULT_MIN_MATCH_TO_APPLY,
    title: text(formData, 'title'),
    domain: domainValue === 'shore' ? 'shore' : 'sea',
    department: nullableText(formData, 'department'),
    rank: nullableText(formData, 'rank'),
    vesselTypes: csv(formData, 'vesselTypes'),
    location: nullableText(formData, 'location'),
    regions: csv(formData, 'regions'),
    summary: text(formData, 'summary'),
    description: text(formData, 'description'),
    requirements: nullableText(formData, 'requirements'),
    experienceMinYears: nullableNumber(formData, 'experienceMinYears'),
    experienceMaxYears: nullableNumber(formData, 'experienceMaxYears'),
    joiningFrom: nullableText(formData, 'joiningFrom'),
    salaryMin: nullableNumber(formData, 'salaryMin'),
    salaryMax: nullableNumber(formData, 'salaryMax'),
    salaryCurrency: nullableText(formData, 'salaryCurrency'),
    salaryPeriod: salaryPeriodValue === 'day' || salaryPeriodValue === 'year' || salaryPeriodValue === 'month' ? salaryPeriodValue : null,
    urgent: formData.get('urgent') === 'on',
    easyApply: formData.get('easyApply') === 'on',
    applyUntil: nullableText(formData, 'applyUntil'),
    certificates: csv(formData, 'certificates'),
    visas: csv(formData, 'visas'),
  }
}

/** What the fields start with: the saved job, a restored local copy, or (for a new job) the defaults. */
type JobFormSeed = { values: Partial<HiringJobUpdateInput>; publisherKey?: string | null }

function seedValues(seed: Partial<HiringJobUpdateInput>): HiringJobUpdateInput {
  return {
    title: '', domain: 'sea', department: null, rank: null, vesselTypes: [], location: null, regions: [], summary: '',
    description: '', requirements: null, experienceMinYears: null, experienceMaxYears: null, joiningFrom: null, salaryMin: null,
    salaryMax: null, salaryCurrency: 'USD', salaryPeriod: 'month', urgent: false, easyApply: true, applyUntil: null,
    certificates: [], visas: [], departmentKey: null, acceptedRoleKeys: [], roleOtherText: null, minMatchToApply: DEFAULT_MIN_MATCH_TO_APPLY,
    ...seed,
  }
}

function seedFromStoredDraft(draft: StoredFormDraft): JobFormSeed {
  const formData = formDataFromSnapshot(draft.values)
  return { values: buildInput(formData), publisherKey: nullableText(formData, 'publisherIdentity') }
}

function intentFailedTitle(attempt: HiringJobSaveIntent | null) {
  return attempt === 'publish' ? 'The job wasn’t published' : 'The job wasn’t saved'
}

type FieldIssueTone = 'error' | 'publish' | 'warning'

/** Round H (H7) / hotfix P2: an error, what a saved draft needs before publishing, or a warning. */
function FieldIssue({ id, issue }: { id: string; issue: { message: string; tone: FieldIssueTone } | null }) {
  if (!issue) return null
  return (
    <span id={id} className={`block text-xs font-medium ${issue.tone === 'error' ? 'text-red-700' : issue.tone === 'publish' ? 'text-red-800' : 'text-amber-800'}`}>
      {issue.tone === 'warning' ? 'Check: ' : issue.tone === 'publish' ? 'Before you publish: ' : ''}{issue.message}
    </span>
  )
}

function join(values: string[] | undefined) {
  return values?.join(', ') ?? ''
}

/** The saved department and ranks, or for an older job the rank its text is recognised as. */
function initialRoles(initial: Partial<HiringJobUpdateInput> | undefined): AcceptedRolesValue {
  if (initial?.departmentKey) {
    return { departmentKey: initial.departmentKey, acceptedRoleKeys: initial.acceptedRoleKeys ?? [], otherText: initial.roleOtherText ?? '' }
  }
  const recognised = roleByKey(normaliseLegacyRank(initial?.rank))
  if (recognised && domainForDepartment(recognised.department) === (initial?.domain ?? 'sea')) {
    return { departmentKey: recognised.department, acceptedRoleKeys: [recognised.key], otherText: '' }
  }
  return { departmentKey: '', acceptedRoleKeys: [], otherText: '' }
}

function savedAtLabel(savedAt: string) {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return 'earlier'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date)
}

/**
 * Hotfix P2: the form never loses what was typed. It submits itself (no React form reset), "Save draft"
 * needs only a title (or rank) while Publish runs every check, errors are listed at the top and under
 * each field, and a local copy (per member and job) survives reloads and an expired session.
 */
export function HiringJobForm(props: HiringJobFormProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [seed, setSeed] = useState<{ version: number; seed: JobFormSeed; restoredFrom: string | null }>(() => ({
    version: 0,
    seed: { values: props.mode === 'edit' ? props.initial : {} },
    restoredFrom: null,
  }))
  const restore = useCallback((draft: StoredFormDraft) => {
    setSeed((current) => ({ version: current.version + 1, seed: seedFromStoredDraft(draft), restoredFrom: draft.savedAt }))
  }, [])
  const storageKey = props.draftOwnerId
    ? formDraftStorageKey({ form: 'hiring-job', ownerId: props.draftOwnerId, recordId: props.mode === 'edit' ? props.jobId : null })
    : null
  const autosave = useFormAutosave({ storageKey, formRef, onSessionRestore: restore })
  useUnsavedChangesWarning(autosave.dirty)

  return (
    <div className="space-y-4">
      {autosave.pending ? (
        <section aria-label="Unsaved job" className="flex flex-wrap items-center gap-3 rounded-2xl border border-ocean-200 bg-ocean-50 px-4 py-3 text-sm text-navy-950">
          <p className="min-w-0 flex-1 font-semibold">Restore your unsaved job from {savedAtLabel(autosave.pending.savedAt)}?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { const draft = autosave.takePending(); if (draft) restore(draft) }}
              className="min-h-11 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={autosave.discardPending}
              className="min-h-11 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2"
            >
              Discard
            </button>
          </div>
        </section>
      ) : null}
      <HiringJobFormFields
        key={seed.version}
        {...props}
        seed={seed.seed}
        restoredFrom={seed.restoredFrom}
        formRef={formRef}
        autosave={autosave}
      />
    </div>
  )
}

type Autosave = ReturnType<typeof useFormAutosave>

function HiringJobFormFields(props: HiringJobFormProps & {
  seed: JobFormSeed
  restoredFrom: string | null
  formRef: RefObject<HTMLFormElement | null>
  autosave: Autosave
}) {
  const { seed, formRef, autosave } = props
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const initial = props.mode === 'edit' ? props.initial : undefined
  const values = seed.values
  const initialPublisher = props.mode === 'create'
    ? props.publisherOptions.find((option) => option.key === seed.publisherKey && option.canPublish)
      ?? props.publisherOptions.find((option) => option.canPublish) ?? props.publisherOptions[0] ?? null
    : null
  const [publisherKey, setPublisherKey] = useState(initialPublisher?.key ?? '')
  const [roles, setRoles] = useState<AcceptedRolesValue>(() => initialRoles(values))
  // Domain follows the department; it stays editable only while no department is chosen.
  const departmentDomain = domainForDepartment(roles.departmentKey)
  const [pendingIntent, setPendingIntent] = useState<HiringJobSaveIntent>('save')
  const selectedPublisher = props.mode === 'create'
    ? props.publisherOptions.find((option) => option.key === publisherKey) ?? null
    : null
  const today = todayIsoDate()
  const savedJoiningFrom = initial?.joiningFrom ?? null
  const minJoiningDate = savedJoiningFrom && savedJoiningFrom < today ? savedJoiningFrom : today
  // A new job or a draft saves with only a title; a live or archived job is checked in full on every save.
  const draftContext = props.mode === 'create' || initial?.status === 'draft'

  // What the fields hold now (the roles come from the picker's state), checked as you type.
  const [current, setCurrent] = useState<HiringJobUpdateInput>(() => seedValues(values))
  const [attempt, setAttempt] = useState<HiringJobSaveIntent | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(
    props.restoredFrom
      ? `Restored your unsaved job from ${savedAtLabel(props.restoredFrom)}.`
      : props.mode === 'edit' && props.notice === 'draft' ? 'Draft saved.' : null,
  )
  const [focusRequest, setFocusRequest] = useState<{ count: number; target: 'field' | 'summary' }>({ count: 0, target: 'field' })
  const summaryRef = useRef<HTMLDivElement>(null)

  const withRoles = useCallback((input: HiringJobUpdateInput): HiringJobUpdateInput => ({
    ...input,
    departmentKey: roles.departmentKey || null,
    acceptedRoleKeys: roles.departmentKey ? roles.acceptedRoleKeys : [],
    roleOtherText: roles.otherText.trim() || null,
    domain: departmentDomain ?? input.domain,
  }), [departmentDomain, roles])

  const rulesFor = useCallback((intent: HiringJobSaveIntent, input: HiringJobUpdateInput): JobFormValidation => {
    const publish = validateJobPublish(input, {
      today,
      savedJoiningFrom: draftContext ? null : savedJoiningFrom,
      requireDepartment: draftContext,
      checkApplyUntil: intent === 'publish' || draftContext || initial?.status === 'published',
    })
    if (intent === 'save' && draftContext) return { errors: validateJobDraft(input), warnings: publish.warnings }
    return publish
  }, [draftContext, initial?.status, savedJoiningFrom, today])

  const live = withRoles(current)
  const shown = rulesFor(attempt ?? 'save', live)
  const errors = attempt ? shown.errors : []
  // Before you publish: what a saved draft still needs (shown on a draft, never blocking the save).
  const checklist = draftContext && props.mode === 'edit' && attempt !== 'publish' && !errors.length
    ? rulesFor('publish', live).errors
    : []

  // Just saved as a draft from Post a job: start at the first thing left to finish.
  const arrivedAsDraft = props.mode === 'edit' && props.notice === 'draft'
  useEffect(() => {
    if (!arrivedAsDraft) return
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (first) focusFormField(first)
  }, [arrivedAsDraft, formRef])

  useEffect(() => {
    if (!focusRequest.count) return
    if (focusRequest.target === 'summary') {
      focusFormField(summaryRef.current)
      return
    }
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    focusFormField(first ?? summaryRef.current)
  }, [focusRequest, formRef])

  function recheck() {
    autosave.markDirty()
    if (formRef.current) setCurrent(buildInput(new FormData(formRef.current)))
  }

  function fieldIssue(field: JobFormField): { message: string; tone: FieldIssueTone } | null {
    const error = errors.find((issue) => issue.field === field)
    if (error) return { message: error.message, tone: 'error' }
    const unfinished = checklist.find((issue) => issue.field === field)
    if (unfinished) return { message: unfinished.message, tone: 'publish' }
    const warning = shown.warnings.find((issue) => issue.field === field)
    return warning ? { message: warning.message, tone: 'warning' } : null
  }

  function fieldProps(field: JobFormField, hintId?: string) {
    const issue = fieldIssue(field)
    const describedBy = [hintId, issue ? `hiring-job-${field}-issue` : null].filter(Boolean).join(' ')
    return {
      id: fieldId(field),
      'aria-invalid': issue && issue.tone !== 'warning' ? true : undefined,
      'aria-describedby': describedBy || undefined,
    }
  }

  function roleErrors() {
    const entries = (['departmentKey', 'acceptedRoleKeys', 'roleOtherText'] as const)
      .map((field) => {
        const issue = fieldIssue(field)
        return [field, issue ? `${issue.tone === 'publish' ? 'Before you publish: ' : ''}${issue.message}` : undefined] as const
      })
      .filter(([, value]) => Boolean(value))
    return Object.fromEntries(entries) as Partial<Record<'departmentKey' | 'acceptedRoleKeys' | 'roleOtherText', string>>
  }

  function issueLinks(issues: JobFormIssue[]) {
    return [...issues]
      .sort((a, b) => JOB_FORM_FIELD_ORDER.indexOf(a.field) - JOB_FORM_FIELD_ORDER.indexOf(b.field))
      .map((issue) => ({ fieldId: fieldId(issue.field), label: FIELD_LABELS[issue.field], message: issue.message }))
  }

  async function signInAgain(failure?: HiringActionFailure) {
    autosave.save('session_expired')
    setServerError(failure?.error ?? 'Your session has expired. Sign in again to continue; what you typed is kept on this device.')
    setFocusRequest((value) => ({ count: value.count + 1, target: 'summary' }))
    goToSignInAgain()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    // Hotfix P2: the form submits itself, so React never resets the fields, whatever the result.
    event.preventDefault()
    const form = event.currentTarget
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const intent: HiringJobSaveIntent = submitter?.value === 'publish' ? 'publish' : 'save'
    const fields = withRoles(buildInput(new FormData(form)))
    setCurrent(fields)
    setAttempt(intent)
    setServerError(null)
    setMessage(null)

    const checked = rulesFor(intent, fields)
    if (checked.errors.length) {
      autosave.save()
      setFocusRequest((value) => ({ count: value.count + 1, target: 'field' }))
      return
    }

    if (props.mode === 'create' && (!selectedPublisher || !selectedPublisher.canPublish)) {
      setServerError(
        selectedPublisher?.blocker === 'verification_required'
          ? 'Verification is required before this identity can publish jobs.'
          : 'A qualifying Pro plan is required before this identity can publish jobs.',
      )
      setFocusRequest((value) => ({ count: value.count + 1, target: 'summary' }))
      return
    }

    // A draft without a title is named after its rank, and the title field shows it.
    if (intent === 'save' && draftContext && !fields.title) {
      fields.title = jobDraftTitle(fields)
      const titleInput = form.elements.namedItem('title')
      if (titleInput instanceof HTMLInputElement) titleInput.value = fields.title
    }
    setPendingIntent(intent)
    // The local copy is up to date before the request, in case the session has expired.
    autosave.save()

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof updateHiringJob>> | Awaited<ReturnType<typeof createHiringJob>>
      try {
        result = props.mode === 'create'
          ? await createHiringJob({
              publisherType: selectedPublisher!.kind,
              companyId: selectedPublisher!.kind === 'organization' ? selectedPublisher!.id : null,
              ...fields,
              status: intent === 'publish' ? 'published' : 'draft',
            } satisfies HiringJobInput)
          : await updateHiringJob(props.jobId, fields, intent)
      } catch {
        if (await hasSessionEnded()) {
          await signInAgain()
          return
        }
        setServerError(CONNECTION_LOST_MESSAGE)
        setFocusRequest((value) => ({ count: value.count + 1, target: 'summary' }))
        return
      }

      if (!result.ok) {
        if (result.code === 'session_expired') {
          await signInAgain(result)
          return
        }
        setServerError(result.error)
        setFocusRequest((value) => ({ count: value.count + 1, target: 'summary' }))
        return
      }

      autosave.clear()
      setAttempt(null)
      if (props.mode === 'create') {
        setMessage(intent === 'publish' ? 'Job published.' : 'Draft saved.')
        // Round I (I1): a published job opens "Your job is live: share it" on the jobs list. A draft opens
        // for editing, with what is left before publishing (hotfix P2).
        const jobId = 'jobId' in result ? result.jobId : null
        router.push(intent === 'publish'
          ? jobId ? `/hiring/jobs?notice=published&share=${jobId}` : '/hiring/jobs?notice=published'
          : jobId ? `/hiring/jobs/${jobId}/edit?notice=draft` : '/hiring/jobs?notice=draft')
      } else {
        setMessage(intent === 'publish' ? 'Changes saved and the job is live.' : draftContext ? 'Draft saved.' : 'Changes saved.')
        if (intent === 'save' && draftContext) setFocusRequest((value) => ({ count: value.count + 1, target: 'field' }))
      }
    })
  }

  const primaryButtonClass = 'min-h-11 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
  const secondaryButtonClass = 'min-h-11 rounded-xl border border-mist-200 bg-white px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
  const publishLabel = props.mode === 'create' ? 'Publish job' : props.publishLabel ?? null
  const saveLabel = props.mode === 'create'
    ? 'Save as draft'
    : initial?.status === 'draft' ? 'Save draft' : 'Save changes'

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={submit}
      onChange={recheck}
      onBlur={autosave.flush}
      aria-describedby={errors.length || serverError ? 'hiring-job-issues' : undefined}
      className={`space-y-5 ${FORM_FIELD_SCROLL_MARGIN_CLASS}`}
    >
      {errors.length || serverError ? (
        <FormIssueSummary
          ref={summaryRef}
          id="hiring-job-issues"
          tone="error"
          title={errors.length ? thingsToFix(errors.length) : intentFailedTitle(attempt)}
          intro={serverError}
          issues={issueLinks(errors)}
        />
      ) : checklist.length ? (
        <FormIssueSummary
          ref={summaryRef}
          id="hiring-job-checklist"
          tone="checklist"
          title={`Before you publish: ${thingsToFix(checklist.length)}`}
          intro="Your draft is saved as it is. These need finishing before the job can go live."
          issues={issueLinks(checklist)}
        />
      ) : null}
      {props.mode === 'create' ? (
        <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Publishing identity</p>
            <h2 className="mt-1 text-xl font-bold text-navy-950">Publish as</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Choose your verified personal recruiter identity or an organization workspace you manage.
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {props.publisherOptions.map((option) => {
              const selected = publisherKey === option.key
              const blocked = !option.canPublish
              return (
                <label
                  key={option.key}
                  className={`rounded-2xl border p-4 transition ${
                    selected
                      ? 'border-ocean-500 bg-ocean-50 ring-1 ring-ocean-100'
                      : 'border-mist-100 bg-white'
                  } ${blocked ? 'opacity-80' : 'cursor-pointer hover:border-ocean-300'}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="publisherIdentity"
                      value={option.key}
                      checked={selected}
                      disabled={blocked}
                      onChange={() => setPublisherKey(option.key)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-navy-950">{option.name}</span>
                        <span className="rounded-full bg-mist-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-muted">
                          {option.kind === 'personal' ? 'Personal' : 'Organization'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {option.kind === 'personal'
                          ? 'Independent recruiter publishing under your own verified professional identity.'
                          : `Publishing for this organization${option.role ? ` · ${option.role}` : ''}.`}
                      </p>

                      {option.blocker === 'upgrade_required' ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900">PRO required</span>
                          <Link href="/plans" className="text-xs font-bold text-ocean-700 hover:underline">
                            View plans
                          </Link>
                        </div>
                      ) : null}

                      {option.blocker === 'verification_required' ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900">Verification required</span>
                          {option.kind === 'organization' ? (
                            <Link href="/organizations" className="text-xs font-bold text-ocean-700 hover:underline">
                              Manage organization verification
                            </Link>
                          ) : (
                            <>
                              <span className="text-xs text-muted">Recruiter verification must be approved before publishing.</span>
                              <Link href="/settings/verifications/recruiter" className="text-xs font-bold text-ocean-700 hover:underline">
                                Apply for verification
                              </Link>
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>

          {props.publisherOptions.length === 0 ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              No publishing identity is available yet. Complete your profile, verification and plan setup first.
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Role</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Describe the opportunity</h2>
          <p className="mt-1 text-sm text-muted">Use structured maritime fields so the right professionals can be matched to this vacancy.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label className={`block ${labelClass}`}>
              Job title
              <input className={inputClass} name="title" defaultValue={values.title ?? ''} placeholder="Chief Officer" required maxLength={JOB_TITLE_MAX_LENGTH} {...fieldProps('title', draftContext ? 'hiring-job-title-hint' : undefined)} />
            </label>
            {draftContext ? <span id="hiring-job-title-hint" className="block text-xs font-normal text-muted">A draft needs only a title (or a rank). Everything else can wait until you publish.</span> : null}
            <FieldIssue id="hiring-job-title-issue" issue={fieldIssue('title')} />
          </div>

          <AcceptedRolesPicker value={roles} onChange={setRoles} labelClassName={labelClass} inputClassName={inputClass} idPrefix="hiring-job" errors={roleErrors()} />

          <div className={labelClass}>
            <label htmlFor="hiring-job-domain">Job type</label>
            {departmentDomain ? (
              <>
                <select id="hiring-job-domain" className={inputClass} value={departmentDomain} disabled aria-describedby="hiring-job-domain-hint">
                  <option value="sea">Sea job</option>
                  <option value="shore">Shore job</option>
                </select>
                <input type="hidden" name="domain" value={departmentDomain} />
                <span id="hiring-job-domain-hint" className="block text-xs font-normal text-muted">Set by the department.</span>
              </>
            ) : (
              <select id="hiring-job-domain" className={inputClass} name="domain" defaultValue={values.domain ?? 'sea'}>
                <option value="sea">Sea job</option>
                <option value="shore">Shore job</option>
              </select>
            )}
          </div>

          {!roles.departmentKey && initial ? (
            // An older job keeps its saved department and rank text until a department is picked.
            <>
              <input type="hidden" name="department" value={initial.department ?? ''} />
              <input type="hidden" name="rank" value={initial.rank ?? ''} />
            </>
          ) : null}

          <div className="space-y-1.5">
            <label className={`block ${labelClass}`}>
              Location
              <input className={inputClass} name="location" defaultValue={values.location ?? ''} placeholder="Worldwide / Mumbai / Dubai" maxLength={160} {...fieldProps('location')} />
            </label>
            <FieldIssue id="hiring-job-location-issue" issue={fieldIssue('location')} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label className={`block ${labelClass}`}>
              Summary
              <textarea className={`${inputClass} min-h-24`} name="summary" defaultValue={values.summary ?? ''} placeholder="A concise overview candidates will see first." required maxLength={500} {...fieldProps('summary')} />
            </label>
            <FieldIssue id="hiring-job-summary-issue" issue={fieldIssue('summary')} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label className={`block ${labelClass}`}>
              Description
              <textarea className={`${inputClass} min-h-40`} name="description" defaultValue={values.description ?? ''} placeholder="Responsibilities, contract details and role context." required maxLength={12000} {...fieldProps('description', 'hiring-job-description-hint')} />
            </label>
            <span id="hiring-job-description-hint" className="block text-xs font-normal text-muted">At least {JOB_DESCRIPTION_MIN_LENGTH} characters, and more than the job title.</span>
            <FieldIssue id="hiring-job-description-issue" issue={fieldIssue('description')} />
          </div>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Maritime requirements</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Define the professional fit</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label className={`block ${labelClass}`}>
              Vessel types
              <input className={inputClass} name="vesselTypes" defaultValue={join(values.vesselTypes)} placeholder="Oil Tanker, Chemical Tanker" aria-describedby="hiring-job-vesselTypes-hint" />
            </label>
            <span id="hiring-job-vesselTypes-hint" className="block text-xs font-normal text-muted">Separate multiple values with commas.</span>
          </div>

          <fieldset className="rounded-xl border border-mist-100 p-4 sm:col-span-2">
            <legend className="px-1 text-sm font-semibold text-navy-900">Experience</legend>
            <div className="mt-1 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className={`block ${labelClass}`}>
                  Minimum years
                  <input className={inputClass} type="number" min="0" step="0.5" name="experienceMinYears" defaultValue={values.experienceMinYears ?? ''} {...fieldProps('experienceMinYears')} />
                </label>
                <FieldIssue id="hiring-job-experienceMinYears-issue" issue={fieldIssue('experienceMinYears')} />
              </div>
              <div className="space-y-1.5">
                <label className={`block ${labelClass}`}>
                  Maximum years
                  <input className={inputClass} type="number" min="0" step="0.5" name="experienceMaxYears" defaultValue={values.experienceMaxYears ?? ''} {...fieldProps('experienceMaxYears')} />
                </label>
                <FieldIssue id="hiring-job-experienceMaxYears-issue" issue={fieldIssue('experienceMaxYears')} />
              </div>
            </div>
          </fieldset>

          <div className="space-y-1.5 sm:col-span-2">
            <label className={`block ${labelClass}`}>
              Sailing regions
              <input className={inputClass} name="regions" defaultValue={join(values.regions)} placeholder="Worldwide, Middle East, Europe" {...fieldProps('regions')} />
            </label>
            <FieldIssue id="hiring-job-regions-issue" issue={fieldIssue('regions')} />
          </div>

          <label className={labelClass}>
            Certificates
            <input className={inputClass} name="certificates" defaultValue={join(values.certificates)} placeholder="STCW, Advanced Oil Tanker" />
          </label>

          <label className={labelClass}>
            Visas
            <input className={inputClass} name="visas" defaultValue={join(values.visas)} placeholder="US C1/D, Schengen" />
          </label>

          <label className={`${labelClass} sm:col-span-2`}>
            Other requirements
            <textarea className={`${inputClass} min-h-28`} name="requirements" defaultValue={values.requirements ?? ''} maxLength={8000} placeholder="Additional eligibility, vessel or contract requirements." />
          </label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Joining & compensation</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Set joining date and salary</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className={`block ${labelClass}`}>
              Joining date
              <input className={inputClass} type="date" name="joiningFrom" min={minJoiningDate} defaultValue={values.joiningFrom ?? ''} {...fieldProps('joiningFrom')} />
            </label>
            <FieldIssue id="hiring-job-joiningFrom-issue" issue={fieldIssue('joiningFrom')} />
          </div>
          <div className="space-y-1.5">
            <label className={`block ${labelClass}`}>
              Last date to apply
              <input className={inputClass} type="date" name="applyUntil" defaultValue={values.applyUntil ?? ''} {...fieldProps('applyUntil', 'hiring-job-applyUntil-hint')} />
            </label>
            <span id="hiring-job-applyUntil-hint" className="block text-xs font-normal text-muted">Leave empty to keep applications open.</span>
            <FieldIssue id="hiring-job-applyUntil-issue" issue={fieldIssue('applyUntil')} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelClass}>
            Salary minimum
            <input className={inputClass} type="number" min="0" step="1" name="salaryMin" defaultValue={values.salaryMin ?? ''} />
          </label>
          <div className="space-y-1.5">
            <label className={`block ${labelClass}`}>
              Salary maximum
              <input className={inputClass} type="number" min="0" step="1" name="salaryMax" defaultValue={values.salaryMax ?? ''} {...fieldProps('salaryMax')} />
            </label>
            <FieldIssue id="hiring-job-salaryMax-issue" issue={fieldIssue('salaryMax')} />
          </div>
          <label className={labelClass}>
            Currency
            <input className={inputClass} name="salaryCurrency" defaultValue={values.salaryCurrency ?? 'USD'} placeholder="USD" />
          </label>
          <label className={labelClass}>
            Salary period
            <select className={inputClass} name="salaryPeriod" defaultValue={values.salaryPeriod ?? 'month'}>
              <option value="month">Per month</option>
              <option value="day">Per day</option>
              <option value="year">Per year</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Publishing</p>
            <h2 className="mt-1 text-xl font-bold text-navy-950">Control how candidates see this role</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-mist-100 px-3 py-2 text-sm font-medium text-navy-900">
                <input type="checkbox" name="urgent" defaultChecked={values.urgent ?? false} />
                Urgent joining
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-mist-100 px-3 py-2 text-sm font-medium text-navy-900">
                <input type="checkbox" name="easyApply" defaultChecked={values.easyApply ?? true} />
                Easy Apply
              </label>
            </div>
            <label className={`${labelClass} mt-4 block max-w-xs`}>
              Minimum match to apply
              <span className="flex items-center gap-2">
                <input
                  className={inputClass}
                  type="number"
                  name="minMatchToApply"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={values.minMatchToApply ?? DEFAULT_MIN_MATCH_TO_APPLY}
                  aria-describedby="hiring-job-min-match-hint"
                />
                <span className="text-sm font-semibold text-muted">%</span>
              </span>
              <span id="hiring-job-min-match-hint" className="block text-xs font-normal text-muted">0 turns it off. Candidates below this match can’t apply.</span>
            </label>
            <p className="mt-3 text-xs leading-5 text-muted">
              {props.mode === 'create'
                ? 'Save a draft to finish later, or publish now to start receiving applications.'
                : 'Archive, republish or delete this job from the job actions above.'}
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="submit"
              name="intent"
              value="save"
              disabled={isPending}
              className={publishLabel ? secondaryButtonClass : primaryButtonClass}
            >
              {isPending && pendingIntent === 'save' ? 'Saving…' : saveLabel}
            </button>
            {publishLabel ? (
              <button
                type="submit"
                name="intent"
                value="publish"
                disabled={isPending}
                className={primaryButtonClass}
              >
                {isPending && pendingIntent === 'publish' ? 'Publishing…' : publishLabel}
              </button>
            ) : null}
          </div>
        </div>

        {errors.length || serverError ? (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {errors.length ? `${thingsToFix(errors.length)}, listed at the top of the form. ` : 'Not saved yet: see the message at the top of the form. '}
            Everything you typed is kept.
          </p>
        ) : message ? (
          <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}
      </section>
    </form>
  )
}
