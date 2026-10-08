'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { learnerAssignmentRepository, type LearnerAssignmentState, type VerifiedAssignmentAttachment } from './learner-assignment-repository'
import { AssignmentAttachmentError, createPendingAssignmentUpload, verifyAssignmentUpload } from './assignment-attachments'
import { ASSIGNMENT_ATTACHMENT_LIMITS } from './assignment-policy'

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const uuidSchema = z.string().uuid()
const responseSchema = z.string().trim().max(50000)
const fileSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().max(255),
  size: z.number().int().positive().max(ASSIGNMENT_ATTACHMENT_LIMITS.maxUploadBytes),
})
const attachmentSchema = fileSchema.extend({ storagePath: z.string().min(1).max(1024) })
const submissionSchema = z.object({
  responseText: responseSchema,
  submissionId: uuidSchema.nullable(),
  attachments: z.array(attachmentSchema).max(ASSIGNMENT_ATTACHMENT_LIMITS.maxFiles, `Attach at most ${ASSIGNMENT_ATTACHMENT_LIMITS.maxFiles} files.`),
})

export type AssignmentSubmissionInput = z.input<typeof submissionSchema>

type UploadResult =
  | { ok: true; upload: { storagePath: string; uploadUrl: string; mimeType: string; name: string } }
  | { ok: false; error: string }

type SubmitResult =
  | { ok: true; attemptId: string; attemptNumber: number; status: 'submitted'; submittedAt: string; completed: false }
  | { ok: false; error: string }

type StateResult =
  | { ok: true; state: LearnerAssignmentState }
  | { ok: false; error: string }

function message(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'assignment_not_accessible') return 'This assignment is not available yet.'
    if (error.message === 'assignment_already_completed') return 'This assignment is already complete.'
    if (error.message === 'assignment_review_pending') return 'Your latest submission is awaiting mentor review.'
    if (error.message === 'learning_attempt_limit_reached') return 'You have used all attempts allowed for this assignment.'
    if (error.message === 'assignment_submission_empty') return 'Write a response or attach a file before submitting.'
    if (error.message === 'assignment_too_many_files') return 'This assignment accepts fewer files. Remove some and submit again.'
    if (error.message === 'assignment_attachment_invalid') return 'One of the files was not uploaded for this submission. Remove it and attach it again.'
  }
  if (error instanceof AssignmentAttachmentError) return error.learnerMessage
  return 'We could not submit this assignment. Please try again.'
}

export async function getLearningAssignmentState(slug: string, lessonId: string): Promise<StateResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLesson = uuidSchema.safeParse(lessonId)
  if (!parsedSlug.success || !parsedLesson.success) return { ok: false, error: 'Invalid assignment.' }

  try {
    const user = await requireAwsUser()
    const state = await learnerAssignmentRepository.getState(user.id, parsedSlug.data, parsedLesson.data)
    if (!state) return { ok: false, error: 'This assignment is not available.' }
    return { ok: true, state }
  } catch {
    return { ok: false, error: 'We could not load this assignment result.' }
  }
}

/**
 * A presigned upload for one file of a submission the learner can make now. `submissionId` is the
 * id the learner's browser chose for this submission; every file of it shares that prefix.
 */
export async function createAssignmentAttachmentUpload(
  slug: string,
  lessonId: string,
  submissionId: string,
  file: { name: string; mimeType: string; size: number },
): Promise<UploadResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLesson = uuidSchema.safeParse(lessonId)
  const parsedSubmission = uuidSchema.safeParse(submissionId)
  const parsedFile = fileSchema.safeParse(file)
  if (!parsedSlug.success || !parsedLesson.success || !parsedSubmission.success) return { ok: false, error: 'Invalid assignment.' }
  if (!parsedFile.success) return { ok: false, error: 'This file is empty or larger than 100 MB.' }

  try {
    const user = await requireAwsUser()
    const target = await learnerAssignmentRepository.getSubmissionTarget(user.id, parsedSlug.data, parsedLesson.data)
    const upload = await createPendingAssignmentUpload({
      enrollmentId: target.enrollmentId,
      lessonId: target.lessonId,
      submissionId: parsedSubmission.data,
      rules: target.rules,
      ...parsedFile.data,
    })
    return { ok: true, upload }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}

export async function submitLearningAssignment(
  slug: string,
  lessonId: string,
  input: AssignmentSubmissionInput,
): Promise<SubmitResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLesson = uuidSchema.safeParse(lessonId)
  const parsed = submissionSchema.safeParse(input)
  if (!parsedSlug.success || !parsedLesson.success) return { ok: false, error: 'Invalid assignment.' }
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid assignment submission.' }
  if (!parsed.data.responseText && parsed.data.attachments.length === 0) {
    return { ok: false, error: 'Write a response or attach a file before submitting.' }
  }
  if (parsed.data.attachments.length > 0 && !parsed.data.submissionId) return { ok: false, error: 'Invalid assignment submission.' }

  try {
    const user = await requireAwsUser()
    const target = await learnerAssignmentRepository.getSubmissionTarget(user.id, parsedSlug.data, parsedLesson.data)
    if (parsed.data.attachments.length > target.rules.maxFiles) {
      return { ok: false, error: `This assignment accepts up to ${target.rules.maxFiles} file${target.rules.maxFiles === 1 ? '' : 's'}. Remove some and submit again.` }
    }
    const verified: VerifiedAssignmentAttachment[] = []
    for (const attachment of parsed.data.attachments) {
      verified.push(await verifyAssignmentUpload({
        enrollmentId: target.enrollmentId,
        lessonId: target.lessonId,
        submissionId: parsed.data.submissionId!,
        rules: target.rules,
        ...attachment,
      }))
    }
    const result = await learnerAssignmentRepository.submit(user.id, parsedSlug.data, parsedLesson.data, {
      responseText: parsed.data.responseText || null,
      submissionId: parsed.data.submissionId,
      attachments: verified,
    })
    revalidatePath('/learn/my-learning')
    revalidatePath(`/learn/courses/${parsedSlug.data}/learn`)
    return { ok: true, ...result }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}
