'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { userCan } from '@/features/access/server'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { coursePaymentRepository } from './course-payment-repository'
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
    if (!await userCan(user.id, 'course.enroll')) {
      return { ok: false, error: 'Your account cannot enroll in courses right now.' }
    }
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

type TeamAccessResult = { ok: true; href: string } | { ok: false; error: string }

/**
 * Opens a published course for its team without buying it: the course owner, its
 * organization's owners / administrators / LMS managers, and platform admins.
 */
export async function openCourseAsTeamMember(courseId: string): Promise<TeamAccessResult> {
  const parsedId = courseIdSchema.safeParse(courseId)
  if (!parsedId.success) return { ok: false, error: 'This course is no longer available.' }

  try {
    const user = await requireAwsUser()
    const allowed = await coursePaymentRepository.isCourseManager(user.id, parsedId.data)
      || await canAccessPlatformAdmin(user.id)
    if (!allowed) {
      return { ok: false, error: 'Only the course owner, its organization’s learning managers and the Sea N Shore team can open this course without buying it.' }
    }
    await enrollmentRepository.grantTeamAccess(user.id, parsedId.data)
    const slug = await coursePaymentRepository.getCourseSlug(parsedId.data)
    revalidatePath('/learn/my-learning')
    return { ok: true, href: slug ? `/learn/courses/${slug}/learn` : '/learn/my-learning' }
  } catch (error) {
    if (error instanceof Error && error.message === 'course_not_enrollable') {
      return { ok: false, error: 'This course is not published right now, so it cannot be opened here.' }
    }
    return { ok: false, error: 'We could not open this course just now. Please try again.' }
  }
}
