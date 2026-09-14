'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { enrollmentRepository } from './enrollment-repository'

const courseIdSchema = z.string().uuid()

type EnrollmentActionResult =
  | { ok: true; enrollmentId: string; alreadyEnrolled: boolean }
  | { ok: false; error: string }

function enrollmentError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'course_not_enrollable') {
      return 'This course is not currently available for free enrollment.'
    }
    if (error.message === 'enrollment_revoked') {
      return 'Your access to this course has been revoked. Please contact Sea N Shore support.'
    }
  }
  return 'We could not enroll you in this course. Please try again.'
}

export async function enrollInFreeCourse(courseId: string): Promise<EnrollmentActionResult> {
  const parsedId = courseIdSchema.safeParse(courseId)
  if (!parsedId.success) return { ok: false, error: 'Invalid course.' }

  try {
    const user = await requireAwsUser()
    const result = await enrollmentRepository.enrollFreeCourse(user.id, parsedId.data)
    revalidatePath('/learn')
    revalidatePath('/learn/my-learning')
    return {
      ok: true,
      enrollmentId: result.enrollmentId,
      alreadyEnrolled: result.alreadyEnrolled,
    }
  } catch (error) {
    return { ok: false, error: enrollmentError(error) }
  }
}
