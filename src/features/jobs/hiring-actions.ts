'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { requireCapability } from '@/features/access/server'
import { assessPlatformText, automatedModerationDetails, moderationBlockMessage, type AutomatedModerationAssessment } from '@/features/moderation/automated'
import { moderationRepository } from '@/features/moderation/repository'
import { isOwnerSettableApplicationStatus, validateApplicationStatusChange } from './application-status'
import {
  hiringRepository,
  managedJobLifecycle,
  type HiringJobInput,
  type HiringJobStatus,
  type HiringJobUpdateInput,
  type ManagedHiringJobSummary,
} from './hiring-repository'
import {
  todayIsoDate,
  validateApplyUntilForStatus,
  validateJobTransition,
  type JobLifecycleAction,
} from './job-lifecycle'
import { JOB_APPLICATION_STATUSES, type JobApplicationStatus } from './types'

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter dates as full dates.').nullable()
const optionalText = (max: number) => z.string().trim().max(max).nullable()

const jobFieldsSchema = z.object({
  title: z.string().trim().min(2, 'Add a job title of at least 2 characters.').max(160),
  domain: z.enum(['sea', 'shore']),
  department: optionalText(120),
  rank: optionalText(120),
  vesselTypes: z.array(z.string().trim().min(1).max(120)).max(30),
  location: optionalText(160),
  regions: z.array(z.string().trim().min(1).max(160)).max(30),
  summary: z.string().trim().min(1, 'Add a short summary candidates will see first.').max(500),
  description: z.string().trim().min(1, 'Describe the role before saving.').max(12000),
  requirements: optionalText(8000),
  experienceMinYears: z.number().min(0).max(80).nullable(),
  experienceMaxYears: z.number().min(0).max(80).nullable(),
  joiningFrom: dateSchema,
  joiningUntil: dateSchema,
  salaryMin: z.number().min(0).max(100000000).nullable(),
  salaryMax: z.number().min(0).max(100000000).nullable(),
  salaryCurrency: z.string().trim().min(3).max(8).nullable(),
  salaryPeriod: z.enum(['day', 'month', 'year']).nullable(),
  urgent: z.boolean(),
  easyApply: z.boolean(),
  applyUntil: dateSchema,
  certificates: z.array(z.string().trim().min(1).max(160)).max(50),
  visas: z.array(z.string().trim().min(1).max(160)).max(30),
}).superRefine((value, context) => {
  if (value.salaryMin !== null && value.salaryMax !== null && value.salaryMin > value.salaryMax) {
    context.addIssue({ code: 'custom', path: ['salaryMax'], message: 'Maximum salary must be at least the minimum salary.' })
  }
  if (value.experienceMinYears !== null && value.experienceMaxYears !== null && value.experienceMinYears > value.experienceMaxYears) {
    context.addIssue({ code: 'custom', path: ['experienceMaxYears'], message: 'Maximum experience must be at least the minimum experience.' })
  }
  if (value.joiningFrom && value.joiningUntil && value.joiningFrom > value.joiningUntil) {
    context.addIssue({ code: 'custom', path: ['joiningUntil'], message: 'Joining end date must be on or after the start date.' })
  }
})

const createJobSchema = z.union([
  z.object({
    publisherType: z.literal('personal'),
    companyId: z.null(),
    status: z.enum(['draft', 'published', 'closed']),
  }).and(jobFieldsSchema),
  z.object({
    publisherType: z.literal('organization'),
    companyId: uuidSchema,
    status: z.enum(['draft', 'published', 'closed']),
  }).and(jobFieldsSchema),
])
const updateJobSchema = jobFieldsSchema
const saveIntentSchema = z.enum(['save', 'publish'])
const lifecycleActionSchema = z.enum(['publish', 'archive', 'republish'])
const lifecycleOptionsSchema = z.object({ applyUntil: dateSchema.optional() }).default({})
const applicationStatusSchema = z.enum(JOB_APPLICATION_STATUSES)
const statusNoteSchema = z.string().trim().max(1000, 'Keep the message to the applicant under 1,000 characters.').nullable()
const recruiterNoteSchema = z.string().trim().min(1, 'Add a note before saving.').max(4000)

export type HiringActionResult = { ok: true } | { ok: false; error: string }
export type HiringCreateResult = { ok: true; jobId: string } | { ok: false; error: string }
export type HiringJobSaveIntent = z.infer<typeof saveIntentSchema>
export type HiringLifecycleChange = z.infer<typeof lifecycleActionSchema>

class HiringValidationError extends Error {
  constructor(readonly userMessage: string) {
    super('hiring_validation_failed')
    this.name = 'HiringValidationError'
  }
}

function validationError(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Please check the information and try again.'
}

function safeMutationError(error: unknown) {
  if (error instanceof HiringValidationError) return error.userMessage
  if (error instanceof Error && error.message === 'hiring_forbidden') {
    return 'You can’t manage this job. Only the person who posted it, or the organization’s owners, administrators and recruiters, can.'
  }
  if (error instanceof Error && error.message === 'capability_required') {
    return 'Creator Pro or Organization Pro with verified hiring access is required for job publishing.'
  }
  if (error instanceof Error && error.message === 'job_state_changed') {
    return 'This job was changed in another window. Refresh the page to see its current state, then try again.'
  }
  if (error instanceof Error && error.message === 'application_state_changed') {
    return 'This application was updated by someone else. Refresh the page to see its current status, then try again.'
  }
  if (error instanceof Error && error.message === 'application_status_not_allowed') {
    return 'That status change is not available for this application. Refresh the page and choose another status.'
  }
  return 'Something went wrong. Please try again.'
}

function databaseErrorField(error: unknown, field: string) {
  if (typeof error !== 'object' || error === null) return null
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' && value.trim() ? value : null
}

function logHiringMutationError(operation: string, error: unknown) {
  if (error instanceof HiringValidationError) return
  if (error instanceof Error && error.message === 'hiring_forbidden') return

  console.error('hiring_mutation_failed', {
    operation,
    name: error instanceof Error ? error.name : null,
    message: error instanceof Error ? error.message : null,
    code: databaseErrorField(error, 'code'),
    constraint: databaseErrorField(error, 'constraint'),
    table: databaseErrorField(error, 'table'),
    column: databaseErrorField(error, 'column'),
  })
}

function allowAssessment(): AutomatedModerationAssessment {
  return { decision: 'allow', category: null, reason: null, ruleIds: [] } as AutomatedModerationAssessment
}

function assessJobContent(input: HiringJobUpdateInput, status: HiringJobStatus) {
  if (status !== 'published') return allowAssessment()
  return assessPlatformText([
    input.title,
    input.department,
    input.rank,
    input.location,
    input.summary,
    input.description,
    input.requirements,
    ...input.vesselTypes,
    ...input.regions,
    ...input.certificates,
    ...input.visas,
  ])
}

async function flagAutomatedJobModeration(jobId: string, assessment: AutomatedModerationAssessment) {
  if (assessment.decision !== 'review' || !assessment.reason) return
  const details = automatedModerationDetails(assessment)
  if (!details) return
  try {
    await moderationRepository.flagContentAutomatically({
      targetType: 'job',
      targetId: jobId,
      reason: assessment.reason,
      details,
    })
  } catch (error) {
    console.error('hiring_automated_moderation_flag_failed', {
      jobId,
      message: error instanceof Error ? error.message : null,
    })
  }
}

function refreshJobMutation(jobId: string) {
  revalidatePath('/hiring')
  revalidatePath('/hiring/jobs')
  revalidatePath(`/hiring/jobs/${jobId}/applicants`)
  revalidatePath('/jobs')
  revalidatePath(`/jobs/${jobId}`)
}

async function requirePublishCapability(userId: string, companyId: string | null) {
  if (companyId) {
    await requireCapability(userId, 'job.publish', { companyId })
  } else {
    await requireCapability(userId, 'job.publish')
  }
}

async function requireManagedJob(userId: string, jobId: string): Promise<ManagedHiringJobSummary> {
  const job = await hiringRepository.getManagedJob(userId, jobId)
  if (!job) throw new Error('hiring_forbidden')
  return job
}

export async function createHiringJob(input: HiringJobInput): Promise<HiringCreateResult> {
  const parsed = createJobSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }
  if (parsed.data.status === 'closed') return { ok: false, error: 'New jobs are saved as a draft or published. Archive a job after it has been live.' }

  const today = todayIsoDate()
  if (parsed.data.status === 'published') {
    const publish = validateJobTransition({
      status: 'draft',
      deleted: false,
      moderationRemoved: false,
      applyUntil: parsed.data.applyUntil,
      joiningUntil: parsed.data.joiningUntil,
      applicantCount: 0,
      canDelete: true,
    }, 'publish', { today })
    if (!publish.ok) return { ok: false, error: publish.message }
  } else {
    const dates = validateApplyUntilForStatus('draft', parsed.data.applyUntil, today)
    if (!dates.ok) return { ok: false, error: dates.message }
  }

  const moderation = assessJobContent(parsed.data, parsed.data.status)
  if (moderation.decision === 'block') return { ok: false, error: moderationBlockMessage() }

  try {
    const user = await requireAwsUser()
    await requirePublishCapability(user.id, parsed.data.publisherType === 'personal' ? null : parsed.data.companyId)
    const jobId = await hiringRepository.createJob(user.id, parsed.data)
    await flagAutomatedJobModeration(jobId, moderation)
    refreshJobMutation(jobId)
    return { ok: true, jobId }
  } catch (error) {
    logHiringMutationError('create_job', error)
    return { ok: false, error: safeMutationError(error) }
  }
}

/**
 * Saves job details. With intent 'publish' a draft is published (or an archived job republished)
 * in the same save; the lifecycle rules in job-lifecycle.ts decide whether that is allowed.
 */
export async function updateHiringJob(
  jobId: string,
  input: HiringJobUpdateInput,
  intent: HiringJobSaveIntent = 'save',
): Promise<HiringActionResult> {
  const parsedJobId = uuidSchema.safeParse(jobId)
  const parsed = updateJobSchema.safeParse(input)
  const parsedIntent = saveIntentSchema.safeParse(intent)
  if (!parsedJobId.success) return { ok: false, error: 'This job link is not valid. Open the job again from Your jobs.' }
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }
  if (!parsedIntent.success) return { ok: false, error: 'Choose whether to save or publish the job.' }

  try {
    const user = await requireAwsUser()
    const job = await requireManagedJob(user.id, parsedJobId.data)
    const today = todayIsoDate()

    let nextStatus: HiringJobStatus = job.status
    if (parsedIntent.data === 'publish' && job.status !== 'published') {
      const action: JobLifecycleAction = job.status === 'draft' ? 'publish' : 'republish'
      const transition = validateJobTransition(
        { ...managedJobLifecycle(job), joiningUntil: parsed.data.joiningUntil },
        action,
        { today, applyUntil: parsed.data.applyUntil },
      )
      if (!transition.ok) throw new HiringValidationError(transition.message)
      nextStatus = transition.to
    }

    const dates = validateApplyUntilForStatus(nextStatus, parsed.data.applyUntil, today)
    if (!dates.ok) throw new HiringValidationError(dates.message)

    const moderation = assessJobContent(parsed.data, nextStatus)
    if (moderation.decision === 'block') throw new HiringValidationError(moderationBlockMessage())

    await requirePublishCapability(user.id, job.companyId)
    await hiringRepository.updateJob(user.id, parsedJobId.data, parsed.data, {
      expectedStatus: job.status,
      nextStatus,
    })
    await flagAutomatedJobModeration(parsedJobId.data, moderation)
    refreshJobMutation(parsedJobId.data)
    revalidatePath(`/hiring/jobs/${parsedJobId.data}/edit`)
    return { ok: true }
  } catch (error) {
    logHiringMutationError('update_job', error)
    return { ok: false, error: safeMutationError(error) }
  }
}

/**
 * Publish a draft, archive a live job, or republish an archived job.
 * `options.applyUntil` sets a new apply-by date for publish/republish (null removes it).
 */
export async function changeHiringJobStatus(
  jobId: string,
  action: HiringLifecycleChange,
  options: { applyUntil?: string | null } = {},
): Promise<HiringActionResult> {
  const parsedJobId = uuidSchema.safeParse(jobId)
  const parsedAction = lifecycleActionSchema.safeParse(action)
  const parsedOptions = lifecycleOptionsSchema.safeParse(options)
  if (!parsedJobId.success) return { ok: false, error: 'This job link is not valid. Open the job again from Your jobs.' }
  if (!parsedAction.success) return { ok: false, error: 'Choose publish, archive or republish.' }
  if (!parsedOptions.success) return { ok: false, error: 'Enter the apply-by date as a full date.' }

  try {
    const user = await requireAwsUser()
    const job = await requireManagedJob(user.id, parsedJobId.data)
    const transition = validateJobTransition(managedJobLifecycle(job), parsedAction.data, {
      today: todayIsoDate(),
      applyUntil: parsedOptions.data.applyUntil,
    })
    if (!transition.ok) throw new HiringValidationError(transition.message)

    let moderation = allowAssessment()
    if (transition.to === 'published') {
      await requirePublishCapability(user.id, job.companyId)
      const details = await hiringRepository.getManagedEditableJob(user.id, parsedJobId.data)
      if (!details) throw new Error('hiring_forbidden')
      moderation = assessJobContent(details, 'published')
      if (moderation.decision === 'block') throw new HiringValidationError(moderationBlockMessage())
    }

    await hiringRepository.changeJobStatus(user.id, parsedJobId.data, {
      from: job.status,
      to: transition.to,
      applyUntil: transition.applyUntil,
    })
    await flagAutomatedJobModeration(parsedJobId.data, moderation)
    refreshJobMutation(parsedJobId.data)
    revalidatePath(`/hiring/jobs/${parsedJobId.data}/edit`)
    return { ok: true }
  } catch (error) {
    logHiringMutationError(`job_${parsedAction.data}`, error)
    return { ok: false, error: safeMutationError(error) }
  }
}

/** Deletes a draft or archived job (soft delete: applications stay in the applicants' history). */
export async function deleteHiringJob(jobId: string): Promise<HiringActionResult> {
  const parsedJobId = uuidSchema.safeParse(jobId)
  if (!parsedJobId.success) return { ok: false, error: 'This job link is not valid. Open the job again from Your jobs.' }

  try {
    const user = await requireAwsUser()
    const job = await requireManagedJob(user.id, parsedJobId.data)
    const transition = validateJobTransition(managedJobLifecycle(job), 'delete', { today: todayIsoDate() })
    if (!transition.ok) throw new HiringValidationError(transition.message)

    await hiringRepository.deleteJob(user.id, parsedJobId.data, job.status)
    refreshJobMutation(parsedJobId.data)
    revalidatePath('/jobs/saved')
    revalidatePath('/jobs/applications')
    return { ok: true }
  } catch (error) {
    logHiringMutationError('delete_job', error)
    return { ok: false, error: safeMutationError(error) }
  }
}

export async function updateHiringApplicationStatus(
  applicationId: string,
  status: JobApplicationStatus,
  note: string | null,
): Promise<HiringActionResult> {
  const parsedApplicationId = uuidSchema.safeParse(applicationId)
  const parsedStatus = applicationStatusSchema.safeParse(status)
  const parsedNote = statusNoteSchema.safeParse(note)
  if (!parsedApplicationId.success) return { ok: false, error: 'This application link is not valid. Open it again from the applicants list.' }
  if (!parsedStatus.success || !isOwnerSettableApplicationStatus(parsedStatus.data)) {
    return { ok: false, error: 'Choose Reviewed, Shortlisted, Interview, Hired or Rejected.' }
  }
  if (!parsedNote.success) return { ok: false, error: validationError(parsedNote.error) }

  try {
    const user = await requireAwsUser()
    const publisher = await hiringRepository.getApplicationPublisherScope(user.id, parsedApplicationId.data)
    if (!publisher) throw new Error('hiring_forbidden')
    const change = validateApplicationStatusChange(publisher.status, parsedStatus.data)
    if (!change.ok) throw new HiringValidationError(change.message)
    if (publisher.companyId) {
      await requireCapability(user.id, 'job.manage_applicants', { companyId: publisher.companyId })
    } else {
      await requireCapability(user.id, 'job.manage_applicants')
    }
    await hiringRepository.updateApplicationStatus(user.id, parsedApplicationId.data, parsedStatus.data, parsedNote.data || null)
    revalidatePath('/hiring')
    revalidatePath('/hiring/jobs')
    revalidatePath(`/hiring/applicants/${parsedApplicationId.data}`)
    revalidatePath('/jobs/applications')
    revalidatePath('/activities')
    return { ok: true }
  } catch (error) {
    logHiringMutationError('update_application_status', error)
    return { ok: false, error: safeMutationError(error) }
  }
}

export async function saveHiringRecruiterNote(applicationId: string, note: string): Promise<HiringActionResult> {
  const parsedApplicationId = uuidSchema.safeParse(applicationId)
  const parsedNote = recruiterNoteSchema.safeParse(note)
  if (!parsedApplicationId.success) return { ok: false, error: 'This application link is not valid. Open it again from the applicants list.' }
  if (!parsedNote.success) return { ok: false, error: validationError(parsedNote.error) }

  try {
    const user = await requireAwsUser()
    const publisher = await hiringRepository.getApplicationPublisherScope(user.id, parsedApplicationId.data)
    if (!publisher) throw new Error('hiring_forbidden')
    if (publisher.companyId) {
      await requireCapability(user.id, 'job.manage_applicants', { companyId: publisher.companyId })
    } else {
      await requireCapability(user.id, 'job.manage_applicants')
    }
    await hiringRepository.saveRecruiterNote(user.id, parsedApplicationId.data, parsedNote.data)
    revalidatePath(`/hiring/applicants/${parsedApplicationId.data}`)
    return { ok: true }
  } catch (error) {
    logHiringMutationError('save_recruiter_note', error)
    return { ok: false, error: safeMutationError(error) }
  }
}
