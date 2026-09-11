'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { hiringRepository, type HiringJobInput, type HiringJobUpdateInput } from './hiring-repository'
import { JOB_APPLICATION_STATUSES, type JobApplicationStatus } from './types'

const uuidSchema = z.string().uuid()
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
const optionalText = (max: number) => z.string().trim().max(max).nullable()

const jobFieldsSchema = z.object({
  title: z.string().trim().min(2).max(160),
  domain: z.enum(['sea', 'shore']),
  department: optionalText(120),
  rank: optionalText(120),
  vesselTypes: z.array(z.string().trim().min(1).max(120)).max(30),
  location: optionalText(160),
  regions: z.array(z.string().trim().min(1).max(160)).max(30),
  summary: z.string().trim().min(1).max(500),
  description: z.string().trim().min(1).max(12000),
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
  status: z.enum(['draft', 'published']),
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

const createJobSchema = z.object({ companyId: uuidSchema }).and(jobFieldsSchema)
const updateJobSchema = jobFieldsSchema
const applicationStatusSchema = z.enum(JOB_APPLICATION_STATUSES)
const statusNoteSchema = z.string().trim().max(1000).nullable()
const recruiterNoteSchema = z.string().trim().min(1).max(4000)

type HiringActionResult = { ok: true } | { ok: false; error: string }
type HiringCreateResult = { ok: true; jobId: string } | { ok: false; error: string }

function validationError(error: z.ZodError) {
  return error.issues[0]?.message ?? 'Please check the information and try again.'
}

function safeMutationError(error: unknown) {
  if (error instanceof Error && error.message === 'hiring_forbidden') {
    return 'You do not have permission to manage this hiring workspace.'
  }
  return 'Something went wrong. Please try again.'
}

function databaseErrorField(error: unknown, field: string) {
  if (typeof error !== 'object' || error === null) return null
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' && value.trim() ? value : null
}

function logHiringMutationError(operation: string, error: unknown) {
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

function refreshJobMutation(jobId: string) {
  revalidatePath('/hiring')
  revalidatePath('/hiring/jobs')
  revalidatePath('/jobs')
  revalidatePath(`/jobs/${jobId}`)
}

export async function createHiringJob(input: HiringJobInput): Promise<HiringCreateResult> {
  const parsed = createJobSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }

  try {
    const user = await requireAwsUser()
    const jobId = await hiringRepository.createJob(user.id, parsed.data)
    refreshJobMutation(jobId)
    return { ok: true, jobId }
  } catch (error) {
    logHiringMutationError('create_job', error)
    return { ok: false, error: safeMutationError(error) }
  }
}

export async function updateHiringJob(jobId: string, input: HiringJobUpdateInput): Promise<HiringActionResult> {
  const parsedJobId = uuidSchema.safeParse(jobId)
  const parsed = updateJobSchema.safeParse(input)
  if (!parsedJobId.success) return { ok: false, error: 'Invalid job.' }
  if (!parsed.success) return { ok: false, error: validationError(parsed.error) }

  try {
    const user = await requireAwsUser()
    await hiringRepository.updateJob(user.id, parsedJobId.data, parsed.data)
    refreshJobMutation(parsedJobId.data)
    revalidatePath(`/hiring/jobs/${parsedJobId.data}/edit`)
    return { ok: true }
  } catch (error) {
    logHiringMutationError('update_job', error)
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
  if (!parsedApplicationId.success) return { ok: false, error: 'Invalid application.' }
  if (!parsedStatus.success) return { ok: false, error: 'Invalid application status.' }
  if (!parsedNote.success) return { ok: false, error: validationError(parsedNote.error) }

  try {
    const user = await requireAwsUser()
    await hiringRepository.updateApplicationStatus(user.id, parsedApplicationId.data, parsedStatus.data, parsedNote.data || null)
    revalidatePath('/hiring')
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
  if (!parsedApplicationId.success) return { ok: false, error: 'Invalid application.' }
  if (!parsedNote.success) return { ok: false, error: validationError(parsedNote.error) }

  try {
    const user = await requireAwsUser()
    await hiringRepository.saveRecruiterNote(user.id, parsedApplicationId.data, parsedNote.data)
    revalidatePath(`/hiring/applicants/${parsedApplicationId.data}`)
    return { ok: true }
  } catch (error) {
    logHiringMutationError('save_recruiter_note', error)
    return { ok: false, error: safeMutationError(error) }
  }
}
