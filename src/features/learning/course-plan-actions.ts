'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { firstPlainIssue } from '@/lib/validation/plain-messages'
import { coursePlanRepository } from './course-plan-repository'
import { coursePlansSchema, type CoursePlan, type CoursePlanInput } from './course-plans'
import { courseEditLockedCopy } from './course-workflow'

type Result = { ok: true; plans: CoursePlan[] } | { ok: false; error: string }

const PLAN_LABELS = { name: 'Plan name', priceMinor: 'Price', discountPriceMinor: 'Sale price', currency: 'Currency', accessMonths: 'Access period' }

/**
 * Saves a paid course's pricing plans (round C, C3) on a draft or a draft revision: changes to a live course go
 * through review, and a new price applies to new purchases only. The first plan always sells the course price
 * from the course details.
 */
export async function saveCoursePlans(courseId: string, plans: CoursePlanInput[]): Promise<Result> {
  const parsedCourse = z.string().uuid().safeParse(courseId)
  if (!parsedCourse.success) return { ok: false, error: 'This course link is no longer valid. Reload the page and try again.' }
  const parsed = coursePlansSchema.safeParse(plans)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const index = typeof issue?.path[0] === 'number' ? issue.path[0] : null
    const message = firstPlainIssue(new z.ZodError(issue ? [{ ...issue, path: issue.path.slice(1) }] : []), 'Check the plans and try again.', PLAN_LABELS)
    return { ok: false, error: index === null ? message : `Plan ${index + 1}: ${message}` }
  }
  try {
    const user = await requireAwsUser()
    const saved = await coursePlanRepository.save(user.id, parsedCourse.data, parsed.data)
    revalidatePath(`/learn/studio/courses/${parsedCourse.data}/edit`)
    return { ok: true, plans: saved }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'course_not_found') return { ok: false, error: 'Approved trainer access to this course is required.' }
      if (error.message === 'course_edit_forbidden') return { ok: false, error: courseEditLockedCopy(null, 'Your pricing plans') }
      if (error.message === 'course_not_paid') return { ok: false, error: 'Set the course to paid, with a price, and save the course details before adding plans.' }
      if (error.message === 'course_plan_not_found') return { ok: false, error: 'A plan changed while you were editing. Reload the page and try again.' }
    }
    return { ok: false, error: 'We could not save the plans. Please try again.' }
  }
}
