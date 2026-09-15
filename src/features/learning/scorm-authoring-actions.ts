'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { processScormPackageForMentor } from './scorm-authoring'

const uuid = z.string().uuid()
const pathSchema = z.string().min(1).max(1024)

type Result =
  | { ok: true; version: '1.2' | '2004'; launchPath: string; fileCount: number }
  | { ok: false; error: string }

function message(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'material_not_found') return 'We could not find this SCORM material.'
    if (error.message === 'material_not_scorm') return 'This material is not configured as SCORM.'
    if (error.message === 'course_edit_forbidden') return 'This course is read-only while it is under review or published.'
    if (error.message.includes('manifest')) return 'The ZIP does not contain a valid root SCORM manifest.'
    if (error.message.includes('version')) return 'Only SCORM 1.2 and SCORM 2004 packages are supported.'
    if (error.message.includes('zip')) return 'The SCORM ZIP is invalid, unsafe, or exceeds the package limits.'
  }
  return 'We could not process this SCORM package. Review the ZIP and try again.'
}

export async function processCurriculumScormPackage(
  courseId: string,
  materialId: string,
  sourceZipPath: string,
): Promise<Result> {
  const course = uuid.safeParse(courseId)
  const lesson = uuid.safeParse(materialId)
  const path = pathSchema.safeParse(sourceZipPath)
  if (!course.success || !lesson.success || !path.success) return { ok: false, error: 'Invalid SCORM package.' }

  try {
    const user = await requireAwsUser()
    const result = await processScormPackageForMentor({
      actorId: user.id,
      courseId: course.data,
      lessonId: lesson.data,
      sourceZipPath: path.data,
    })
    revalidatePath(`/learn/studio/courses/${course.data}/edit`)
    return { ok: true, version: result.version, launchPath: result.launchPath, fileCount: result.fileCount }
  } catch (error) {
    revalidatePath(`/learn/studio/courses/${course.data}/edit`)
    return { ok: false, error: message(error) }
  }
}
