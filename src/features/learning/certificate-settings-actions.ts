'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { certificateSettingsRepository } from './certificate-settings-repository'
import { certificateSettingsSchema, type CourseCertificateSettings } from './certificate-settings'
import { courseEditLockedCopy } from './course-workflow'
import { verifyLearningMediaObject } from './media'
import { learningMediaRepository } from './media-repository'
import { firstPlainIssue } from '@/lib/validation/plain-messages'

type Result = { ok: true; settings: CourseCertificateSettings } | { ok: false; error: string }

/** Saves how a course's certificate looks and when it is issued (draft courses and draft revisions only). */
export async function saveCourseCertificateSettings(courseId: string, input: CourseCertificateSettings): Promise<Result> {
  const parsedCourse = z.string().uuid().safeParse(courseId)
  if (!parsedCourse.success) return { ok: false, error: 'Invalid course.' }
  const parsed = certificateSettingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: firstPlainIssue(parsed.error, 'Check the certificate settings and try again.') }

  try {
    const user = await requireAwsUser()
    for (const [kind, path, label] of [
      ['certificate_logo', parsed.data.logoPath, 'logo'],
      ['certificate_signature', parsed.data.signaturePath, 'signature'],
    ] as const) {
      if (!path) continue
      try {
        await verifyLearningMediaObject({
          userId: user.id,
          courseId: parsedCourse.data,
          kind,
          storagePath: path,
          alreadyAttached: await learningMediaRepository.isMediaReferenced(user.id, parsedCourse.data, path),
        })
      } catch {
        return { ok: false, error: `We could not verify the uploaded ${label}. Please upload it again.` }
      }
    }
    await certificateSettingsRepository.save(user.id, parsedCourse.data, parsed.data)
    revalidatePath(`/learn/studio/courses/${parsedCourse.data}/edit`)
    return { ok: true, settings: parsed.data }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'course_not_found') return { ok: false, error: 'Approved trainer access to this course is required.' }
      if (error.message === 'course_edit_forbidden') return { ok: false, error: courseEditLockedCopy(null, 'Your certificate settings') }
      if (error.message === 'certificate_final_quiz_invalid') return { ok: false, error: 'Choose a quiz from this course as the final quiz.' }
    }
    return { ok: false, error: 'We could not save the certificate settings. Please try again.' }
  }
}
