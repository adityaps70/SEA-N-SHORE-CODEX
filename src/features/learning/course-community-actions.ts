'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { courseCommunityRepository } from './course-community-repository'

/** Learning round C (C7): link a course to a community, and open it from the player. */

export type LinkCourseCommunityResult = { ok: true; groupId: string | null } | { ok: false; error: string }

const uuid = z.string().uuid()

export async function linkCourseCommunity(courseId: string, groupId: string | null): Promise<LinkCourseCommunityResult> {
  if (!uuid.safeParse(courseId).success) return { ok: false, error: 'This course link is no longer valid. Reload the page and try again.' }
  if (groupId !== null && !uuid.safeParse(groupId).success) return { ok: false, error: 'Choose one of the communities in the list.' }

  const user = await requireAwsUser()
  try {
    const result = await courseCommunityRepository.setLink(user.id, courseId, groupId)
    revalidatePath('/learn/studio/courses/[courseId]/edit', 'page')
    revalidatePath('/learn/courses/[slug]/learn', 'page')
    return { ok: true, groupId: result.groupId }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'course_not_found') return { ok: false, error: 'Only the people who run this course can change its community.' }
    if (code === 'community_not_allowed') return { ok: false, error: 'You can link only a community where you are an owner or admin, and that is not archived.' }
    console.error('[course_community_link_failed]', { code: code.slice(0, 80) || 'unknown_error' })
    return { ok: false, error: 'We could not save the community. Please try again.' }
  }
}

export type OpenCourseDiscussionResult = { ok: false; error: string }

const DISCUSSION_ERRORS: Record<string, string> = {
  discussion_not_enrolled: 'The course discussion is for learners enrolled in this course.',
  discussion_unavailable: 'This course doesn’t have a discussion community at the moment.',
  discussion_removed: 'A community admin removed you from this course’s community, so it can’t add you back. Contact the trainer if you think this is a mistake.',
}

/** Re-checks the enrolment, grants access to a private community, then opens the community page. */
export async function openCourseDiscussion(courseId: string): Promise<OpenCourseDiscussionResult> {
  if (!uuid.safeParse(courseId).success) return { ok: false, error: 'This course link is no longer valid. Reload the page and try again.' }
  const user = await requireAwsUser()
  let slug: string
  try {
    slug = (await courseCommunityRepository.openDiscussion(user.id, courseId)).slug
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (DISCUSSION_ERRORS[code]) return { ok: false, error: DISCUSSION_ERRORS[code]! }
    console.error('[course_discussion_failed]', { code: code.slice(0, 80) || 'unknown_error' })
    return { ok: false, error: 'We could not open the discussion. Please try again.' }
  }
  redirect(`/community/${encodeURIComponent(slug)}`)
}
