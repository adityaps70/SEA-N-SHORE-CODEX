'use server'

import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  createPendingLearningMediaUpload,
  removeLearningMediaObject,
  resolveLearningMediaReadUrl,
} from './media'
import { learningMediaRepository } from './media-repository'
import {
  isOwnedLearningMediaStoragePath,
  validateLearningMediaMetadata,
  type LearningMediaKind,
} from './media-policy'

const courseIdSchema = z.string().uuid()
const kindSchema = z.enum([
  'course_thumbnail',
  'course_trailer',
  'lesson_video',
  'lesson_image',
  'lesson_audio',
  'lesson_document',
  'lesson_resource',
  'scorm_package',
])
const storagePathSchema = z.string().min(1).max(1024)

type ActionResult = { ok: true } | { ok: false; error: string }
type UploadResult = {
  ok: true
  upload: Awaited<ReturnType<typeof createPendingLearningMediaUpload>>
} | { ok: false; error: string }
type ReadResult = { ok: true; url: string } | { ok: false; error: string }

function authorizationError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'course_not_found') return 'Approved mentor access to this course is required.'
    if (error.message === 'course_edit_forbidden') return 'Course media is read-only while this course is in review or published.'
  }
  return 'We could not prepare this media request. Please try again.'
}

export async function createLearningMediaUpload(input: {
  courseId: string
  kind: LearningMediaKind
  mimeType: string
  size: number
}): Promise<UploadResult> {
  const parsedCourse = courseIdSchema.safeParse(input.courseId)
  if (!parsedCourse.success) return { ok: false, error: 'Invalid course.' }
  const parsedKind = kindSchema.safeParse(input.kind)
  if (!parsedKind.success) return { ok: false, error: 'Invalid media type.' }
  const metadata = validateLearningMediaMetadata({ kind: parsedKind.data, mimeType: input.mimeType, size: input.size })
  if (!metadata.ok) return { ok: false, error: metadata.error }

  try {
    const user = await requireAwsUser()
    await learningMediaRepository.assertEditableOwnedCourse(user.id, parsedCourse.data)
    const upload = await createPendingLearningMediaUpload({
      userId: user.id,
      courseId: parsedCourse.data,
      kind: parsedKind.data,
      mimeType: metadata.mimeType,
      size: input.size,
    })
    return { ok: true, upload }
  } catch (error) {
    return { ok: false, error: authorizationError(error) }
  }
}

export async function discardLearningMediaUpload(input: {
  courseId: string
  kind: LearningMediaKind
  storagePath: string
}): Promise<ActionResult> {
  const parsedCourse = courseIdSchema.safeParse(input.courseId)
  if (!parsedCourse.success) return { ok: false, error: 'Invalid course.' }
  const parsedKind = kindSchema.safeParse(input.kind)
  const parsedPath = storagePathSchema.safeParse(input.storagePath)
  if (!parsedKind.success || !parsedPath.success) return { ok: false, error: 'Invalid media.' }

  try {
    const user = await requireAwsUser()
    await learningMediaRepository.assertEditableOwnedCourse(user.id, parsedCourse.data)
    if (!isOwnedLearningMediaStoragePath({
      userId: user.id,
      courseId: parsedCourse.data,
      kind: parsedKind.data,
      storagePath: parsedPath.data,
    })) return { ok: false, error: 'Invalid media.' }

    const referenced = await learningMediaRepository.isMediaReferenced(user.id, parsedCourse.data, parsedPath.data)
    if (referenced) return { ok: false, error: 'This media is already attached to the course.' }

    await removeLearningMediaObject({
      userId: user.id,
      courseId: parsedCourse.data,
      kind: parsedKind.data,
      storagePath: parsedPath.data,
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: authorizationError(error) }
  }
}

export async function getLearningMediaReadUrl(input: {
  courseId: string
  kind: LearningMediaKind
  storagePath: string
}): Promise<ReadResult> {
  const parsedCourse = courseIdSchema.safeParse(input.courseId)
  const parsedKind = kindSchema.safeParse(input.kind)
  const parsedPath = storagePathSchema.safeParse(input.storagePath)
  if (!parsedCourse.success || !parsedKind.success || !parsedPath.success) return { ok: false, error: 'Invalid media.' }

  try {
    const user = await requireAwsUser()
    await learningMediaRepository.assertOwnedCourse(user.id, parsedCourse.data)
    const url = await resolveLearningMediaReadUrl({
      userId: user.id,
      courseId: parsedCourse.data,
      kind: parsedKind.data,
      storagePath: parsedPath.data,
    })
    return { ok: true, url }
  } catch {
    return { ok: false, error: 'We could not load this media preview.' }
  }
}
